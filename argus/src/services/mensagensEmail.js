const configuracoes = require('./configuracoes');
const { montarEmail } = require('./emailTemplate');
const { formatar } = require('../util/cnj');
const { fmtDia, diaDaSemana } = require('../util/datas');

function baseUrl() {
    return process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function fmtDataHora(d) {
    return d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
}

async function aparencia() {
    const email = await configuracoes.lerGrupo('email');
    return {
        cabecalho: email.cabecalho,
        cor: email.cor,
        prefixo: email.prefixo_assunto,
        rodape: email.rodape,
        linkOrigem: email.link_origem !== 'false'
    };
}

// Link "Abrir no PJe/eproc" do e-mail. Sem sistema conhecido nao ha link unico: o alerta no Argus
// mostra as duas opcoes.
function linkTribunal(acesso) {
    if (!acesso?.principal) return null;
    return { texto: `Abrir o processo no ${acesso.principal.rotulo}`, url: acesso.principal.url };
}

function infosProcesso({ numero, movimento, dataMovimento, classe, orgao, tribunal, responsavel, acesso }) {
    return [
        ['Processo', formatar(numero), true],
        ['Movimentação', movimento],
        ['Data', fmtDataHora(dataMovimento)],
        ['Classe', classe],
        ['Órgão julgador', orgao],
        ['Tribunal', tribunal ? tribunal.toUpperCase() : null],
        ['Sistema', acesso ? (acesso.sistema ? acesso.sistema.rotulo : 'não identificado (veja no Argus)') : null],
        ['Responsável', responsavel || 'não definido']
    ];
}

/**
 * @param {object} d { alertaId, numero, movimento, dataMovimento, classe, orgao, tribunal, responsavel, acesso }
 *   acesso: resultado de linkBuilder.acessoNoTribunal(processo)
 */
async function novoAlerta(d, ap) {
    ap = ap || (await aparencia());
    return montarEmail({
        tipo: 'novo',
        aparencia: ap,
        assunto: `Nova movimentação — ${formatar(d.numero)}`,
        titulo: 'Nova movimentação que pode abrir prazo',
        texto: 'O Argus identificou uma movimentação que pode abrir prazo processual. Confira e tome as providências no sistema do tribunal. O Argus não dá ciência no tribunal.',
        infos: infosProcesso(d),
        botao: { texto: 'Ver alerta no Argus', url: `${baseUrl()}/alertas/${d.alertaId}` },
        linkSecundario: linkTribunal(d.acesso)
    });
}

/**
 * @param {object} d mesmos campos de novoAlerta + { criadoEm, dias }
 */
async function alertaEscalado(d, ap) {
    ap = ap || (await aparencia());
    return montarEmail({
        tipo: 'escalado',
        aparencia: ap,
        assunto: `Alerta ESCALADO — ${formatar(d.numero)}`,
        titulo: `Alerta sem ciência há mais de ${d.dias} dia(s) útil(eis)`,
        texto: 'Ninguém confirmou no Argus que viu este alerta dentro do prazo interno da Procuradoria, e ele foi escalado. Verifique no sistema do tribunal se há prazo correndo.',
        infos: [...infosProcesso(d), ['Alerta criado em', fmtDataHora(d.criadoEm)]],
        botao: { texto: 'Ver alerta no Argus', url: `${baseUrl()}/alertas/${d.alertaId}` },
        linkSecundario: linkTribunal(d.acesso)
    });
}

async function teste(ap) {
    ap = ap || (await aparencia());
    return montarEmail({
        tipo: 'teste',
        aparencia: ap,
        assunto: 'E-mail de teste',
        titulo: 'A configuração de e-mail está funcionando',
        texto: 'Esta é uma mensagem de teste enviada pela tela de Configurações do Argus. Os alertas de movimentação seguirão este mesmo modelo.',
        infos: [['Enviado em', fmtDataHora(new Date())], ['Servidor do sistema', baseUrl()]],
        botao: { texto: 'Abrir o Argus', url: `${baseUrl()}/painel` }
    });
}

const ROTULO_TIPO = { prazo: 'Prazo', audiencia: 'Audiência', tarefa: 'Tarefa', evento: 'Evento' };

function quando(c) {
    return `${fmtDia(c.data)} (${diaDaSemana(c.data)})${c.hora ? ` às ${c.hora}` : ''}`;
}

/**
 * Aviso para quem passou a ser responsavel por um compromisso (criado ou reatribuido por outra pessoa).
 * @param {object} c compromisso de models/compromissos (findById)
 * @param {string} atribuidoPor nome de quem atribuiu
 */
async function compromissoAtribuido(c, atribuidoPor, ap) {
    ap = ap || (await aparencia());
    const tipo = ROTULO_TIPO[c.tipo] || c.tipo;
    return montarEmail({
        tipo: 'atribuido',
        aparencia: ap,
        assunto: `${tipo} em ${fmtDia(c.data)} — ${c.titulo}`,
        titulo: `${atribuidoPor} atribuiu a você: ${c.titulo}`,
        texto: c.tipo === 'prazo'
            ? 'Um prazo foi lançado na agenda do Argus com você como responsável. Ao cumpri-lo, marque como concluído no sistema.'
            : 'Um compromisso foi lançado na agenda do Argus com você como responsável.',
        infos: [
            ['Tipo', tipo],
            [c.tipo === 'prazo' ? 'Data fatal' : 'Data', quando(c)],
            ['Local', c.local],
            ['Processo', c.numero_processo ? formatar(c.numero_processo) : null, true],
            ['Classe', c.classe_nome],
            ['Descrição', c.descricao]
        ],
        botao: { texto: 'Abrir na agenda do Argus', url: `${baseUrl()}/agenda/${c.id}` }
    });
}

/**
 * Resumo diario de uma pessoa: compromissos vencidos e os dos proximos dias.
 * @param {object} d { nome, hoje, vencidos: [], proximos: [] }
 */
async function resumoAgenda(d, ap) {
    ap = ap || (await aparencia());
    const linha = (c) => {
        const tipo = ROTULO_TIPO[c.tipo] || c.tipo;
        const processo = c.numero_processo ? ` · ${formatar(c.numero_processo)}` : '';
        return [`${fmtDia(c.data)}${c.hora ? ` ${c.hora}` : ''}`, `${tipo}: ${c.titulo}${processo}`];
    };
    const partes = [];
    if (d.vencidos.length) partes.push(`${d.vencidos.length} vencido(s) sem conclusão`);
    const deHoje = d.proximos.filter((c) => c.data === d.hoje).length;
    if (deHoje) partes.push(`${deHoje} para hoje`);
    const futuros = d.proximos.length - deHoje;
    if (futuros) partes.push(`${futuros} nos próximos dias`);
    return montarEmail({
        tipo: 'agenda',
        aparencia: ap,
        assunto: `Sua agenda — ${fmtDia(d.hoje)}${d.vencidos.length ? ` (${d.vencidos.length} vencido(s))` : ''}`,
        titulo: `Bom dia, ${d.nome.split(' ')[0]}: ${partes.join(', ')}`,
        texto: d.vencidos.length
            ? 'Há compromissos com data já passada que ainda não foram marcados como concluídos. Confira se o prazo foi cumprido e atualize a agenda.'
            : 'Estes são os seus compromissos dos próximos dias na agenda do Argus.',
        infos: [
            ...d.vencidos.map((c) => { const [q, t] = linha(c); return [`Vencido ${q}`, t]; }),
            ...d.proximos.map(linha)
        ],
        botao: { texto: 'Abrir a agenda', url: `${baseUrl()}/agenda?responsavel=meus` }
    });
}

// Dados ficticios para a previa na tela de configuracoes.
const EXEMPLO = {
    alertaId: 0,
    numero: '50010985220268130529',
    movimento: 'Intimação confirmada (início de prazo)',
    dataMovimento: new Date(),
    classe: 'Execução Fiscal',
    orgao: 'Vara Única da Comarca de Pratápolis',
    tribunal: 'tjmg',
    responsavel: 'Helena',
    acesso: { sistema: { chave: 'pje', rotulo: 'PJe' }, principal: { rotulo: 'PJe', url: 'https://pje-consulta-publica.tjmg.jus.br/' } },
    criadoEm: new Date(Date.now() - 4 * 864e5),
    dias: 3
};

async function previa(tipo, ap) {
    if (tipo === 'escalado') return alertaEscalado(EXEMPLO, ap);
    if (tipo === 'teste') return teste(ap);
    return novoAlerta(EXEMPLO, ap);
}

module.exports = { aparencia, novoAlerta, alertaEscalado, teste, previa, compromissoAtribuido, resumoAgenda };
