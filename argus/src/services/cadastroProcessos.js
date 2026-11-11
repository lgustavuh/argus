const processosModel = require('../models/processos');
const { extrairNumeros, digitoVerificadorValido, tribunalDoNumero, formatar } = require('../util/cnj');
const { fonteAtiva } = require('../fontes');
const { sincronizar } = require('./reconciliation');

const MAX_POR_IMPORTACAO = 5000;

/**
 * Cadastra processos a partir de texto livre (um numero, uma lista colada de planilha, um CSV...).
 * Numeros invalidos (digito verificador errado) ou de tribunais fora do DataJud sao recusados e
 * listados; os ja cadastrados sao ignorados. Os novos sao consultados na fonte de dados em segundo
 * plano, para a linha do tempo aparecer sem esperar o proximo sync agendado.
 */
async function cadastrar({ texto, origem = 'importacao', observacao = null, responsavelId = null, usuario = null }) {
    const numeros = extrairNumeros(texto);
    const resultado = { cadastrados: [], existentes: [], invalidos: [], semTribunal: [], excedentes: 0, consultaIniciada: false };

    if (numeros.length > MAX_POR_IMPORTACAO) {
        resultado.excedentes = numeros.length - MAX_POR_IMPORTACAO;
        numeros.length = MAX_POR_IMPORTACAO;
    }

    const validos = [];
    for (const numero of numeros) {
        if (!digitoVerificadorValido(numero)) resultado.invalidos.push(formatar(numero));
        else if (!tribunalDoNumero(numero)) resultado.semTribunal.push(formatar(numero));
        else validos.push(numero);
    }

    const existentes = await processosModel.listNumerosExistentes(validos);
    const idsNovos = [];
    for (const numero of validos) {
        if (existentes.has(numero)) {
            resultado.existentes.push(formatar(numero));
            continue;
        }
        const criado = await processosModel.inserirManual({
            numeroProcesso: numero,
            tribunal: tribunalDoNumero(numero),
            origem,
            observacao,
            responsavelId,
            criadoPor: usuario?.id || null
        });
        if (criado) {
            resultado.cadastrados.push({ id: criado.id, numero: formatar(numero) });
            idsNovos.push(criado.id);
        } else {
            resultado.existentes.push(formatar(numero));
        }
    }

    if (idsNovos.length) {
        const fonte = await fonteAtiva();
        if (await fonte.disponivel()) {
            resultado.consultaIniciada = true;
            sincronizar({ processoIds: idsNovos, origem: 'cadastro' }).catch((err) =>
                console.error('[cadastro] Falha na consulta inicial dos processos cadastrados:', err.message)
            );
        }
    }

    return resultado;
}

module.exports = { cadastrar, MAX_POR_IMPORTACAO };
