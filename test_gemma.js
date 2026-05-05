require('dotenv').config();
const { generateVideoScenesJSON } = require('./utils/geminiClient');

async function probarCreacionDeEscenas() {
    console.log("\n" + "=".repeat(60));
    console.log("🎬 INICIANDO PRUEBA DEL DIRECTOR DE TV (GEMMA JSON) 🎬");
    console.log("=".repeat(60) + "\n");

    // Datos de prueba (Simulando lo que sacaría el scraper)
    const tituloFalso = "ROCHA MOYA: PROTECCIÓN DE LA GUARDIA NACIONAL Y ANÁLISIS DE LA EXTRADICIÓN";
    const imagenFalsa = "https://www.elfinanciero.com.mx/resizer/v2/BVLRGKWUCZAK5KQQI574NNPCWM.jpg?smart=true&auth=da160f5b33d3101bcf32028457ec9e5cc06b41c1ede1220bea5b502cb4ea547b&width=1200&height=630";
    const textoLargoFalso = `
Tras solicitar licencia como gobernador de Sinaloa para no obstaculizar las investigaciones de la Fiscalía General de la República (FGR), Rubén Rocha Moya cuenta con elementos de la Guardia Nacional que resguardan su seguridad, según informó la presidenta Claudia Sheinbaum. La decisión se tomó tras una evaluación de riesgo realizada por el Gabinete de Seguridad, un protocolo que se aplica a cualquier ciudadano que solicite apoyo en su seguridad, ya sea un gobernador, legislador o un ciudadano común.

Sheinbaum enfatizó que la protección se ofrece a cualquier persona que sea considerada en riesgo, tras un análisis exhaustivo de la situación. En estos casos como en cualquier otro, sea para un gobernador o gobernador con licencia de cualquier estado, un diputado, senador, ciudadano que tenga consideración de riesgo de su persona solicita a la Guardia Nacional apoyo en su seguridad y se hace un análisis de riesgo , explicó la mandataria.

La solicitud de licencia de Rocha Moya se produjo después de que el gobierno de Estados Unidos lo acusara de presuntos nexos con Los Chapitos y el crimen organizado en Sinaloa. Ante este escenario, el Congreso estatal nombró a Yeraldine Bonilla como gobernadora interina.

En otro orden de ideas, la presidenta Sheinbaum defendió su reciente gira por Palenque, desmintiendo especulaciones sobre una reunión con el expresidente Andrés Manuel López Obrador. No tendría nada de malo que me reuniera con el presidente López Obrador, pero no me reuní con él , afirmó, calificando las acusaciones de misoginia y falta de reconocimiento a su capacidad de tomar decisiones. Me dio mucha risa porque dijeron que hasta hubo un cónclave de morenistas , añadió.

Durante la conferencia matutina, la consejera Jurídica de la Presidencia, Luisa María Alcalde, presentó su primera tarea: analizar la posibilidad de retrasar la elección Judicial al año 2028. Actualmente, la elección está programada para 2027, y el análisis buscará determinar si una reforma que la posponga sería conveniente. Actualmente, esa elección está programada para suceder el próximo año, en 2027, entonces vamos a analizar y emitiremos una opinión a la presidenta si vale la pena en pensar en una reforma , explicó Alcalde. La consejera detalló que la reforma se centrará en evaluar si mantener la elección en 2027 o trasladarla a 2028.

Alcalde también aclaró la diferencia entre una solicitud de extradición y una solicitud de detención provisional con fines de extradición, en el contexto del caso de Rubén Rocha. Explicó que el Departamento de Justicia de Estados Unidos emitió una solicitud de detención provisional con fines de extradición , y no una solicitud formal de extradición.

Según el Tratado de Extradición entre México y Estados Unidos, la solicitud formal de extradición debe entregarse por vía diplomática y contener información detallada sobre el delito imputado, así como pruebas relevantes. En contraste, la solicitud de detención provisional con fines de extradición se regula en el artículo 11 del mismo tratado y se utiliza en situaciones urgentes donde exista riesgo de fuga o obstaculización del proceso. En este caso, la solicitud debe incluir elementos probatorios que acrediten la urgencia de la detención.

La consejera Jurídica explicó que la solicitud de detención provisional permite a las autoridades mexicanas detener a Rocha Moya mientras Estados Unidos prepara la solicitud formal de extradición.

La incorporación de Luisa María Alcalde como consejera Jurídica de la Presidencia fue anunciada por la presidenta Sheinbaum al inicio de la conferencia matutina. La mandataria destacó que Alcalde explicará todos los aspectos relacionados con la solicitud de extradición para mantener informada a la ciudadanía. Luisa María explicará todo lo que tiene que ver con la solicitud de extradición para que todos estén informados de un tema tan importante , dijo la mandataria.

En otros temas, la Procuraduría Federal del Consumidor (Profeco) informó que el litro de diésel se venderá a un precio máximo de 27 pesos esta semana. El precio promedio de la gasolina Magna se encuentra en 23.67 pesos por litro, y Profeco publicó una lista de gasolineras que ofrecen el combustible a precios más bajos.

Por su parte, la nueva secretaria del Bienestar, Leticia Ramírez, dio a conocer el calendario de pagos de la Pensión Bienestar para Adultos Mayores y otros programas sociales. Los depósitos comenzarán el lunes 4 de mayo para las personas cuyos apellidos comiencen con la letra A, y continuarán en orden alfabético hasta el 27 de mayo. Además de la Pensión para Adultos Mayores, se realizarán los depósitos correspondientes a la Pensión Mujeres Bienestar y al Programa Sembrando Vidas.

La situación de Rubén Rocha Moya sigue siendo un tema central en la agenda política nacional, con implicaciones significativas para la seguridad y la cooperación entre México y Estados Unidos. La decisión de otorgar protección de la Guardia Nacional al exgobernador, el análisis de la solicitud de extradición y la evaluación de la posibilidad de retrasar la elección Judicial son elementos clave que definirán el rumbo de los acontecimientos en los próximos meses. La consejera jurídica, Luisa María Alcalde, jugará un papel fundamental en el análisis legal y la coordinación de las acciones gubernamentales en este complejo escenario.`;

    console.log("⏳ Pasando el texto a Gemma para que arme las escenas... (Tardará unos segundos)\n");

    try {
        const jsonEscenas = await generateVideoScenesJSON(tituloFalso, textoLargoFalso, imagenFalsa);

        if (jsonEscenas) {
            console.log("✅ ¡ÉXITO! AQUÍ TIENES EL JSON GENERADO POR LA IA:\n");
            
            // Imprimimos el JSON formateado con sangrías para que lo puedas leer y copiar fácil
            console.log(JSON.stringify(jsonEscenas, null, 4));

            console.log("\n" + "=".repeat(60));
            console.log("👉 INSTRUCCIONES: Copia el texto desde el primer '{' hasta el último '}' y ponlo como tu 'payload' en tu test de Python.");
            console.log("=".repeat(60) + "\n");
        } else {
            console.error("❌ Falló la generación. Revisa si Gemma se confundió con el formato.");
        }

    } catch (error) {
        console.error("❌ ERROR FATAL:", error.message);
    }
}

probarCreacionDeEscenas();