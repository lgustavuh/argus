/**
 * Perfis de usuario do Argus e o que cada um pode fazer.
 *
 * Todos os processos cadastrados sao do Municipio, entao TODOS os perfis veem todos os processos e
 * alertas — nao ha escopo por responsavel. O que muda entre perfis e o que cada um pode alterar:
 *
 * - procurador / advogado: dao ciencia nos alertas, cadastram/importam/arquivam processos e
 *   lancam/concluem compromissos na agenda.
 * - assistente_juridico: somente leitura; recebe os alertas (por e-mail, quando configurado).
 * - admin (TI): todos os privilegios, inclusive as configuracoes do sistema.
 *
 * Nao espalhe `papel === '...'` pelo codigo: use `pode(papel, acao)` e ajuste as listas abaixo.
 */
const PAPEIS_VALIDOS = ['procurador', 'advogado', 'assistente_juridico', 'admin'];

const ROTULOS_PAPEL = {
    procurador: 'Procurador',
    advogado: 'Advogado',
    assistente_juridico: 'Assistente Jurídico',
    admin: 'Admin (TI)'
};

const PERMISSOES = {
    darCiencia: ['procurador', 'advogado', 'admin'],
    gerenciarProcessos: ['procurador', 'advogado', 'admin'],
    gerenciarAgenda: ['procurador', 'advogado', 'admin'],
    rodarSync: ['procurador', 'advogado', 'admin'],
    configurar: ['admin']
};

// Quem recebe e-mail de alerta novo. O admin de TI fica de fora de proposito (nao atua nos processos).
const PAPEIS_RECEBEM_ALERTAS = ['procurador', 'advogado', 'assistente_juridico'];

// Quem pode ser responsavel por um processo ou compromisso da agenda.
const PAPEIS_RESPONSAVEIS = ['procurador', 'advogado'];

// Destino do escalonamento: alerta sem ciencia dentro do prazo interno vai para o(s) procurador(es).
const PAPEL_ESCALONAMENTO = 'procurador';

function papelValido(papel) {
    return PAPEIS_VALIDOS.includes(papel);
}

function pode(papel, acao) {
    return (PERMISSOES[acao] || []).includes(papel);
}

module.exports = {
    PAPEIS_VALIDOS,
    ROTULOS_PAPEL,
    PERMISSOES,
    PAPEIS_RECEBEM_ALERTAS,
    PAPEIS_RESPONSAVEIS,
    PAPEL_ESCALONAMENTO,
    papelValido,
    pode
};
