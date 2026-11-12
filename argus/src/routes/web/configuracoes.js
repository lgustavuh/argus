const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const usuariosModel = require('../../models/usuarios');
const codigosTpuModel = require('../../models/codigosTpu');
const configuracoes = require('../../services/configuracoes');
const auditoria = require('../../services/auditoria');
const { enviarEmail } = require('../../services/mailer');
const outbox = require('../../services/outbox');
const mensagens = require('../../services/mensagensEmail');
const { corValida } = require('../../services/emailTemplate');
const { listarFontes, FONTES } = require('../../fontes');
const { statusSeguranca } = require('../../config/seguranca');
const { cifragemDisponivel } = require('../../util/cripto');
const { validarSenha } = require('../../util/senha');
const { papelValido, PAPEIS_VALIDOS, ROTULOS_PAPEL, PERMISSOES } = require('../../config/papeis');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');
const { statusSync } = require('./painel');

const router = express.Router();

const ABAS = ['geral', 'usuarios', 'alertas', 'email', 'integracao', 'auditoria'];

function statusBackup() {
    const dir = process.env.BACKUP_DIR || '/backups';
    try {
        const arquivos = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.dump'))
            .map((f) => {
                const st = fs.statSync(path.join(dir, f));
                return { nome: f, tamanho: st.size, data: st.mtime };
            })
            .sort((x, y) => y.data - x.data);
        return { disponivel: true, total: arquivos.length, ultimo: arquivos[0] || null };
    } catch (err) {
        return { disponivel: false, total: 0, ultimo: null };
    }
}

router.get('/', a(async (req, res) => {
    const aba = ABAS.includes(req.query.aba) ? req.query.aba : 'geral';
    const dados = { aba, msg: req.query.msg, cfg: await configuracoes.lerParaTela(), cifragemDisponivel: cifragemDisponivel() };

    if (aba === 'geral') {
        dados.seguranca = statusSeguranca();
        dados.backup = statusBackup();
        dados.filaEmails = { contagem: await outbox.contarPorStatus() };
    } else if (aba === 'usuarios') {
        dados.usuarios = await usuariosModel.listAll();
        dados.PAPEIS_VALIDOS = PAPEIS_VALIDOS;
        dados.ROTULOS_PAPEL = ROTULOS_PAPEL;
        dados.PERMISSOES = PERMISSOES;
    } else if (aba === 'alertas') {
        dados.codigosTpu = await codigosTpuModel.listAll();
    } else if (aba === 'email') {
        const [contagem, problemas] = await Promise.all([outbox.contarPorStatus(), outbox.listarProblemas()]);
        dados.filaEmails = { contagem, problemas, maxTentativas: outbox.MAX_TENTATIVAS };
    } else if (aba === 'integracao') {
        dados.fontes = listarFontes();
        dados.sync = await statusSync();
        dados.datajudChaveConfigurada = Boolean(process.env.DATAJUD_API_KEY);
    } else if (aba === 'auditoria') {
        const pag = lerPaginacao(req);
        const { registros, total } = await auditoria.listar(pag);
        dados.registros = registros;
        dados.paginacao = montarPaginacao(req, pag, total);
        dados.ROTULOS_ACAO = auditoria.ROTULOS_ACAO;
    }
    res.render('configuracoes', dados);
}));

async function salvarEAuditar(req, valores) {
    const alteradas = await configuracoes.salvar(valores, req.usuario.id);
    await auditoria.registrar(req, 'config_alterada', { entidade: 'configuracao', detalhes: { chaves: alteradas } });
}

function inteiroEntre(valor, min, max, padrao) {
    const n = Number.parseInt(valor, 10);
    if (!Number.isFinite(n)) return String(padrao);
    return String(Math.min(max, Math.max(min, n)));
}

// ---------- Geral ----------
router.post('/geral', a(async (req, res) => {
    await salvarEAuditar(req, {
        'geral.dias_escalonamento': inteiroEntre(req.body.diasEscalonamento, 1, 60, 3),
        'geral.dias_sem_movimentacao': inteiroEntre(req.body.diasSemMovimentacao, 7, 3650, 60),
        'agenda.lembrete_ativo': req.body.lembreteAtivo === 'true' ? 'true' : 'false',
        'agenda.dias_antecedencia': inteiroEntre(req.body.diasAntecedencia, 0, 30, 3)
    });
    res.redirect(comMsg('/configuracoes?aba=geral', 'Configurações gerais salvas.'));
}));

// ---------- E-mail ----------
router.post('/email', a(async (req, res) => {
    const voltar = '/configuracoes?aba=email';
    if (req.body.smtpSenha && !cifragemDisponivel()) {
        return res.redirect(comMsg(voltar, 'Não foi possível salvar a senha: ENCRYPTION_KEY não está configurada no servidor.'));
    }
    await salvarEAuditar(req, {
        'email.ativo': req.body.ativo === 'true' ? 'true' : 'false',
        'email.smtp_host': (req.body.smtpHost || '').trim(),
        'email.smtp_porta': inteiroEntre(req.body.smtpPorta, 1, 65535, 587),
        'email.smtp_usuario': (req.body.smtpUsuario || '').trim(),
        'email.smtp_senha': req.body.smtpSenha || '',
        'email.remetente': (req.body.remetente || '').trim(),
        'email.fallback': (req.body.fallback || '').trim()
    });
    if (req.body.removerSenha === 'true') await configuracoes.limparSegredo('email.smtp_senha', req.usuario.id);
    res.redirect(comMsg(voltar, 'Configurações de e-mail salvas.'));
}));

const CHAVES_APARENCIA = ['email.nome_remetente', 'email.prefixo_assunto', 'email.cabecalho', 'email.cor', 'email.rodape', 'email.link_origem'];

function lerAparenciaDoFormulario(body) {
    return {
        'email.nome_remetente': (body.nomeRemetente || '').trim().slice(0, 120),
        'email.prefixo_assunto': (body.prefixoAssunto || '').trim().slice(0, 40),
        'email.cabecalho': (body.cabecalho || '').trim().slice(0, 150),
        'email.cor': corValida((body.cor || '').trim()),
        'email.rodape': (body.rodape || '').trim().slice(0, 1000),
        'email.link_origem': body.linkOrigem === 'true' ? 'true' : 'false'
    };
}

router.post('/email/aparencia', a(async (req, res) => {
    const valores = req.body.restaurar === 'true'
        ? Object.fromEntries(CHAVES_APARENCIA.map((c) => [c, configuracoes.PADROES[c]]))
        : lerAparenciaDoFormulario(req.body);
    await salvarEAuditar(req, valores);
    res.redirect(comMsg('/configuracoes?aba=email', req.body.restaurar === 'true' ? 'Aparência padrão restaurada.' : 'Aparência dos e-mails salva.'));
}));

// Previa em nova aba. Com campos na query (botao "Pre-visualizar" do formulario), mostra os
// valores ainda nao salvos; sem eles, a configuracao salva.
router.get('/email/previa', a(async (req, res) => {
    let aparencia = await mensagens.aparencia();
    if (req.query.cabecalho !== undefined) {
        const v = lerAparenciaDoFormulario(req.query);
        aparencia = {
            cabecalho: v['email.cabecalho'],
            cor: v['email.cor'],
            prefixo: v['email.prefixo_assunto'],
            rodape: v['email.rodape'],
            linkOrigem: v['email.link_origem'] === 'true'
        };
    }
    const tipo = ['novo', 'escalado', 'teste'].includes(req.query.tipo) ? req.query.tipo : 'novo';
    const msg = await mensagens.previa(tipo, aparencia);
    // Faixa com o assunto acima do e-mail, so na previa.
    const faixa = `<div style="font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:10px 16px;font-size:13px;">
        Prévia (dados fictícios) — <strong>Assunto:</strong> ${msg.subject.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</div>`;
    res.send(msg.html.replace('<body style="margin:0;padding:0;background:#eef2f7;">', (m) => m + faixa));
}));

router.post('/email/teste', a(async (req, res) => {
    const resultado = await enviarEmail({ to: req.usuario.email, ...(await mensagens.teste()) }, { ignorarAtivo: true });
    await auditoria.registrar(req, 'email_teste', { detalhes: { ok: resultado.ok } });
    const msg = resultado.ok
        ? `E-mail de teste enviado para ${req.usuario.email}.`
        : `Falha no envio: ${resultado.motivo}`;
    res.redirect(comMsg('/configuracoes?aba=email', msg));
}));

router.post('/email/reenviar/:id(\\d+)', a(async (req, res) => {
    const ok = await outbox.reenviar(Number(req.params.id));
    if (ok) await auditoria.registrar(req, 'email_reenviado', { entidade: 'email', entidadeId: Number(req.params.id) });
    res.redirect(comMsg('/configuracoes?aba=email', ok ? 'E-mail de volta à fila: sai no próximo minuto.' : 'Este e-mail não estava com falha.'));
}));

router.post('/email/reenviar-todos', a(async (req, res) => {
    const total = await outbox.reenviarTodosQueFalharam();
    if (total) await auditoria.registrar(req, 'email_reenviado', { detalhes: { total } });
    res.redirect(comMsg('/configuracoes?aba=email', total ? `${total} e-mail(s) de volta à fila.` : 'Nenhum e-mail com falha.'));
}));

// ---------- Integracao (fonte de dados / sync / MNI) ----------
router.post('/integracao', a(async (req, res) => {
    const voltar = '/configuracoes?aba=integracao';
    const fonte = FONTES[req.body.fonte] ? req.body.fonte : 'datajud';
    if (fonte === 'mni' && FONTES.mni.implementado === false) {
        return res.redirect(comMsg(voltar, 'A fonte MNI ainda não pode ser ativada: a integração depende do credenciamento no TJMG.'));
    }
    await salvarEAuditar(req, {
        'sync.ativo': req.body.syncAtivo === 'true' ? 'true' : 'false',
        'sync.fonte': fonte,
        'sync.intervalo_horas': inteiroEntre(req.body.intervaloHoras, 1, 48, 6),
        'sync.janela_carga_inicial_dias': inteiroEntre(req.body.janelaCargaInicial, 0, 90, 15)
    });
    res.redirect(comMsg(voltar, 'Configurações de integração salvas.'));
}));

router.post('/integracao/mni', a(async (req, res) => {
    const voltar = '/configuracoes?aba=integracao';
    if (req.body.senhaConsultante && !cifragemDisponivel()) {
        return res.redirect(comMsg(voltar, 'Não foi possível salvar a senha: ENCRYPTION_KEY não está configurada no servidor.'));
    }
    await salvarEAuditar(req, {
        'mni.wsdl_url': (req.body.wsdlUrl || '').trim(),
        'mni.id_consultante': (req.body.idConsultante || '').trim(),
        'mni.senha_consultante': req.body.senhaConsultante || '',
        'mni.observacoes': (req.body.observacoes || '').trim()
    });
    res.redirect(comMsg(voltar, 'Dados do MNI salvos.'));
}));

// ---------- Alertas (codigos TPU) ----------
router.post('/codigos-tpu', a(async (req, res) => {
    const codigo = Number.parseInt(req.body.codigo, 10);
    const nome = (req.body.nome || '').trim();
    if (!codigo || !nome) return res.redirect(comMsg('/configuracoes?aba=alertas', 'Informe código e nome.'));
    await codigosTpuModel.upsert({ codigo, nome, pesoUrgencia: Number(req.body.pesoUrgencia) || 1 });
    await auditoria.registrar(req, 'tpu_salvo', { entidade: 'tpu', entidadeId: codigo, detalhes: { nome, peso: req.body.pesoUrgencia } });
    res.redirect(comMsg('/configuracoes?aba=alertas', `Código ${codigo} salvo.`));
}));

router.post('/codigos-tpu/:codigo/remover', a(async (req, res) => {
    const codigo = Number.parseInt(req.params.codigo, 10);
    if (await codigosTpuModel.remove(codigo)) {
        await auditoria.registrar(req, 'tpu_removido', { entidade: 'tpu', entidadeId: codigo });
    }
    res.redirect(comMsg('/configuracoes?aba=alertas', `Código ${codigo} removido.`));
}));

// ---------- Usuarios ----------
router.post('/usuarios', a(async (req, res) => {
    const voltar = '/configuracoes?aba=usuarios';
    const { nome, email, papel, senha } = req.body;
    if (!nome?.trim() || !email?.trim() || !senha) return res.redirect(comMsg(voltar, 'Preencha nome, e-mail e senha do novo usuário.'));
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.redirect(comMsg(voltar, erroSenha));
    try {
        const criado = await usuariosModel.create({
            nome: nome.trim(),
            email: email.toLowerCase().trim(),
            senhaHash: await bcrypt.hash(senha, 12),
            papel: papelValido(papel) ? papel : 'assistente_juridico',
            deveTrocarSenha: true
        });
        await auditoria.registrar(req, 'usuario_criado', { entidade: 'usuario', entidadeId: criado.id, detalhes: { papel: criado.papel } });
        res.redirect(comMsg(voltar, 'Usuário criado. Ele deverá trocar a senha no primeiro acesso.'));
    } catch (err) {
        res.redirect(comMsg(voltar, 'Não foi possível criar o usuário — o e-mail já pode estar em uso.'));
    }
}));

router.post('/usuarios/:id/ativo', a(async (req, res) => {
    const voltar = '/configuracoes?aba=usuarios';
    if (Number(req.params.id) === req.usuario.id) return res.redirect(comMsg(voltar, 'Você não pode desativar a própria conta.'));
    const ativo = req.body.ativo === 'true';
    const usuario = await usuariosModel.setAtivo(req.params.id, ativo);
    if (usuario) await auditoria.registrar(req, 'usuario_ativo', { entidade: 'usuario', entidadeId: usuario.id, detalhes: { ativo } });
    res.redirect(voltar);
}));

router.post('/usuarios/:id/papel', a(async (req, res) => {
    const voltar = '/configuracoes?aba=usuarios';
    if (Number(req.params.id) === req.usuario.id) return res.redirect(comMsg(voltar, 'Você não pode alterar o próprio perfil.'));
    if (papelValido(req.body.papel)) {
        const usuario = await usuariosModel.setPapel(req.params.id, req.body.papel);
        if (usuario) await auditoria.registrar(req, 'usuario_papel', { entidade: 'usuario', entidadeId: usuario.id, detalhes: { papel: usuario.papel } });
    }
    res.redirect(voltar);
}));

router.post('/usuarios/:id/senha', a(async (req, res) => {
    const voltar = '/configuracoes?aba=usuarios';
    if (Number(req.params.id) === req.usuario.id) return res.redirect(comMsg('/minha-conta', 'Para trocar a sua senha, use esta tela.'));
    const erroSenha = validarSenha(req.body.senha);
    if (erroSenha) return res.redirect(comMsg(voltar, erroSenha));
    const usuario = await usuariosModel.setSenha(req.params.id, await bcrypt.hash(req.body.senha, 12), { deveTrocarSenha: true });
    if (usuario) await auditoria.registrar(req, 'usuario_senha_redefinida', { entidade: 'usuario', entidadeId: usuario.id });
    res.redirect(comMsg(voltar, 'Senha redefinida. O usuário deverá trocá-la no próximo acesso.'));
}));

module.exports = router;
