// Comportamentos de tela sem script inline (a politica CSP do Argus bloqueia onclick/onchange).
(function () {
    // <select data-auto-submit> envia o formulario ao mudar.
    document.querySelectorAll('[data-auto-submit]').forEach(function (el) {
        el.addEventListener('change', function () { el.form.submit(); });
    });

    // <form data-confirmar="mensagem"> pede confirmacao antes de enviar.
    document.querySelectorAll('form[data-confirmar]').forEach(function (form) {
        form.addEventListener('submit', function (ev) {
            if (!window.confirm(form.getAttribute('data-confirmar'))) ev.preventDefault();
        });
    });

    // <input type="file" data-carregar-em="#idDoTextarea"> le o arquivo (CSV/TXT) para o textarea.
    document.querySelectorAll('input[type=file][data-carregar-em]').forEach(function (input) {
        input.addEventListener('change', function () {
            var alvo = document.querySelector(input.getAttribute('data-carregar-em'));
            var arquivo = input.files && input.files[0];
            if (!alvo || !arquivo) return;
            var leitor = new FileReader();
            leitor.onload = function () {
                alvo.value = (alvo.value ? alvo.value + '\n' : '') + leitor.result;
                alvo.dispatchEvent(new Event('input'));
            };
            leitor.readAsText(arquivo);
        });
    });

    // <input type="color" data-espelho="#id"> mostra o valor hexadecimal ao lado.
    document.querySelectorAll('input[type=color][data-espelho]').forEach(function (input) {
        var alvo = document.querySelector(input.getAttribute('data-espelho'));
        if (alvo) input.addEventListener('input', function () { alvo.textContent = input.value; });
    });

    // Calculadora de data fatal na agenda (logica em /js/prazos.js, carregado so nessas telas).
    document.querySelectorAll('[data-calculadora]').forEach(function (box) {
        if (!window.ArgusPrazos) return;
        var form = box.closest('form');
        var inicio = box.querySelector('[data-calc-inicio]');
        var dias = box.querySelector('[data-calc-dias]');
        var contagem = box.querySelector('[data-calc-contagem]');
        var dobro = box.querySelector('[data-calc-dobro]');
        var saida = box.querySelector('[data-calc-resultado]');
        var aplicar = box.querySelector('[data-calc-aplicar]');
        var campoData = form && form.querySelector('input[name=data]');
        var resultado = null;
        function br(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
        function calcular() {
            resultado = window.ArgusPrazos.calcular({ inicio: inicio.value, dias: dias.value, contagem: contagem.value, dobro: dobro.checked });
            aplicar.disabled = !resultado;
            if (!resultado) { saida.textContent = ''; return; }
            var feriados = resultado.ignorados.filter(function (i) { return i.motivo !== 'sábado' && i.motivo !== 'domingo'; });
            var resumoFeriados = {};
            feriados.forEach(function (i) { resumoFeriados[i.motivo] = (resumoFeriados[i.motivo] || []).concat(br(i.dia).slice(0, 5)); });
            var textoFeriados = Object.keys(resumoFeriados).map(function (m) {
                var l = resumoFeriados[m];
                return m + (l.length > 3 ? ' (' + l.length + ' dias)' : ' (' + l.join(', ') + ')');
            }).join('; ');
            saida.textContent = 'Data fatal: ' + br(resultado.fim) + ' — ' + resultado.diasContados + ' dia(s) ' +
                (contagem.value === 'corridos' ? 'corridos' : 'úteis') + (dobro.checked ? ' (em dobro)' : '') +
                (textoFeriados ? '. Não contados: ' + textoFeriados + '.' : '.');
        }
        [inicio, dias, contagem, dobro].forEach(function (el) { el.addEventListener('input', calcular); el.addEventListener('change', calcular); });
        aplicar.addEventListener('click', function () {
            if (resultado && campoData) { campoData.value = resultado.fim; campoData.focus(); }
        });
    });

    // Campo de etiquetas separadas por virgula: as sugestoes completam so a etiqueta que esta
    // sendo digitada, mantendo as anteriores (o <datalist> sozinho substituiria o campo inteiro).
    document.querySelectorAll('input[data-etiquetas]').forEach(function (input) {
        var lista = input.list;
        if (!lista) return;
        var nomes = Array.prototype.map.call(lista.options, function (o) { return o.value; });
        function atualizar() {
            var corte = input.value.lastIndexOf(',');
            var prefixo = corte >= 0 ? input.value.slice(0, corte + 1).trim() + ' ' : '';
            var usadas = input.value.split(',').map(function (s) { return s.trim().toLowerCase(); });
            lista.innerHTML = '';
            nomes.forEach(function (n) {
                if (usadas.indexOf(n.toLowerCase()) >= 0) return;
                var opt = document.createElement('option');
                opt.value = prefixo + n;
                lista.appendChild(opt);
            });
        }
        input.addEventListener('input', atualizar);
        atualizar();
    });

    // <button data-copiar="#alvo"> copia o texto do elemento; sem permissao de area de transferencia,
    // seleciona o texto para Ctrl+C.
    document.querySelectorAll('[data-copiar]').forEach(function (btn) {
        var alvo = document.querySelector(btn.getAttribute('data-copiar'));
        var aviso = document.querySelector('[data-copiar-msg]');
        if (!alvo) return;
        function selecionar() {
            var r = document.createRange();
            r.selectNodeContents(alvo);
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
            if (aviso) aviso.textContent = 'Texto selecionado. Use Ctrl+C para copiar.';
        }
        btn.addEventListener('click', function () {
            if (!navigator.clipboard) return selecionar();
            navigator.clipboard.writeText(alvo.innerText).then(function () {
                var original = btn.textContent;
                btn.textContent = 'Copiado';
                setTimeout(function () { btn.textContent = original; }, 2000);
            }, selecionar);
        });
    });

    // <button data-inserir="texto"> insere o texto no campo [data-campo-modelo], na posicao do cursor.
    var campoModelo = document.querySelector('[data-campo-modelo]');
    document.querySelectorAll('[data-inserir]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (!campoModelo) return;
            var t = btn.getAttribute('data-inserir');
            var ini = campoModelo.selectionStart, fim = campoModelo.selectionEnd;
            campoModelo.setRangeText(t, ini, fim, 'end');
            campoModelo.focus();
        });
    });

    // Contador de numeros CNJ reconhecidos enquanto o usuario cola a lista.
    document.querySelectorAll('textarea[data-contar-cnj]').forEach(function (ta) {
        var saida = document.querySelector(ta.getAttribute('data-contar-cnj'));
        if (!saida) return;
        var formatado = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
        var corrido = /(^|\D)(\d{20})(?!\d)/g;
        function contar() {
            var vistos = {};
            (ta.value.match(formatado) || []).forEach(function (n) { vistos[n.replace(/\D/g, '')] = true; });
            var resto = ta.value.replace(formatado, ' ');
            var m;
            while ((m = corrido.exec(resto)) !== null) vistos[m[2]] = true;
            var total = Object.keys(vistos).length;
            saida.textContent = total === 1 ? '1 número reconhecido' : total + ' números reconhecidos';
        }
        ta.addEventListener('input', contar);
        contar();
    });
})();
