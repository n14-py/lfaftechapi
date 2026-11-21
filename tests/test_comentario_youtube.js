const assert = require("assert");
const {
    debateValido,
    preguntasDeRespaldo,
    armarDescripcionYComentario
} = require("../utils/geminiClient");

const tituloFuncionarios = "Investigan la formación y los contratos de un funcionario";
const textoFuncionarios = "La Fiscalía General revisa los contratos de Claudia Sheinbaum y el vínculo con la Guardia Nacional. El expediente incluye pagos y declaraciones académicas.";
const tituloTurismo = "El turismo rompe un récord durante el feriado";
const textoTurismo = "El Ministerio de Turismo informó que Cancún y Punta Cana recibieron más viajeros. La Cámara Hotelera pidió explicaciones por las tarifas.";

const preguntasModelo = [
    "¿Hasta qué punto deben ser transparentes los funcionarios públicos con su formación académica, sus contratos y su gestión?",
    "¿Creés que las investigaciones periodísticas son suficientes para exigir respuestas o deberían existir controles mucho más rigurosos?"
].join("\n\n");

const debate = debateValido(preguntasModelo, tituloFuncionarios);
assert.strictEqual((debate.match(/\?/g) || []).length, 2);
assert.ok(debate.includes("formación académica"));
assert.ok(!debate.includes("¿Qué opinás?"));

const conTitulo = debateValido(
    `${tituloFuncionarios}\n${preguntasModelo}`,
    tituloFuncionarios
);
assert.ok(conTitulo.includes("contratos y su gestión"));
assert.ok(!conTitulo.toLowerCase().includes(tituloFuncionarios.toLowerCase()));

assert.strictEqual(debateValido("¿Qué opinás?", tituloFuncionarios), "");

const filtrado = debateValido(
    "2-3 questions, each on a new line, ending in '?'. Must mention a name, institution, place, or fact from the news. Must allow different answers (controversy/debate). No generic \"What do you think?\". Question 1: ¿Deberían las organizaciones estudiantiles y los sindicatos liderar la agenda de las demandas económicas en Europa? Question 2: ¿Es la crisis de acceso a la vivienda el principal motor de la movilización juvenil en los más de 25 países involucrados?",
    "Protestas juveniles en Europa"
);
assert.strictEqual((filtrado.match(/\?/g) || []).length, 2);
assert.ok(filtrado.includes("organizaciones estudiantiles"));
assert.ok(filtrado.includes("acceso a la vivienda"));
assert.ok(!/question\s*\d|2-3 questions|what do you think/i.test(filtrado));
assert.strictEqual(
    debateValido("¿Primera pregunta concreta, con un nombre o un hecho de esta noticia?\n¿Segunda pregunta, distinta, para que dos personas puedan responder distinto?", tituloFuncionarios),
    ""
);

const comentario = armarDescripcionYComentario({
    titulo: tituloFuncionarios,
    textoReal: textoFuncionarios,
    titular: tituloFuncionarios,
    desarrollo: textoFuncionarios,
    hashtags: ["#NoticiasLAT"],
    debate: preguntasModelo
});
assert.ok(comentario.comentario.includes("formación académica"));
assert.ok(comentario.comentario.includes("https://play.google.com/store/apps/details?id=com.noticiaslat.app"));

const sinDebateA = armarDescripcionYComentario({
    titulo: tituloFuncionarios,
    textoReal: textoFuncionarios,
    desarrollo: textoFuncionarios,
    hashtags: ["#NoticiasLAT"],
    debate: ""
});
const sinDebateB = armarDescripcionYComentario({
    titulo: tituloTurismo,
    textoReal: textoTurismo,
    desarrollo: textoTurismo,
    hashtags: ["#NoticiasLAT"],
    debate: ""
});
assert.ok(sinDebateA.comentario.includes("Claudia Sheinbaum") || sinDebateA.comentario.includes("Fiscalía General"));
assert.ok(sinDebateB.comentario.includes("Ministerio de Turismo") || sinDebateB.comentario.includes("Punta Cana"));
assert.notStrictEqual(sinDebateA.comentario, sinDebateB.comentario);
assert.ok((sinDebateA.comentario.match(/\?/g) || []).length >= 2);
assert.ok(preguntasDeRespaldo(tituloTurismo, textoTurismo).includes("?"));

console.log("comentario de youtube: preguntas distintas por noticia");
