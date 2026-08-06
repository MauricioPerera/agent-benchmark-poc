# Puesto 7 Agent Benchmark — POC

POC independiente para evaluar agentes LLM en un entorno de decisiones secuenciales inspirado en el juego Puesto Siete.

El juego original no se modifica. Esta POC separa el entorno de evaluación del cliente visual y conserva solo estas mecánicas:

- reglas de turno;
- documentos y carga;
- casos normales, infracciones y fugitivos;
- sobornos;
- acciones `approve`, `deny`, `confisc`, `reject_bribe` y `accept_bribe`;
- estado acumulado, errores críticos y puntuación;
- generación procedural reproducible por semilla.

## Requisitos

- Node.js 18+.
- Opcional: Ollama instalado y ejecutándose.
- Opcional: modelo `gemma4:cloud` disponible en Ollama.

La integración usa la API local de Ollama en `http://127.0.0.1:11434/api/chat`.

## Ejecución offline

El modo offline usa un agente heurístico y sirve para comprobar que el entorno, el generador y el scoring funcionan:

```powershell
node .\run.cjs --mode offline --episodes 20 --seed 1000
```

También se puede exportar cada episodio en JSONL:

```powershell
node .\run.cjs --mode offline --episodes 100 --seed 1000 --out .\results.jsonl
```

## Ejecución con Ollama

```powershell
ollama run gemma4:cloud
node .\run.cjs --mode ollama --episodes 5 --seed 1000
```

El runner solicita una acción JSON y valida la acción contra el estado real del entorno. La respuesta del modelo nunca decide directamente si acertó: el entorno calcula la respuesta correcta.

Opciones principales:

```text
--model gemma4:cloud
--ollama http://127.0.0.1:11434/api/chat
--difficulty 1|2|3|4|5
--profile standard|ood
--repeats 1
--max-actions 12
--timeout-ms 120000
```

`--max-actions` limita las acciones del agente por episodio. Si se supera, el episodio falla; esto permite medir también bucles o agentes que no consiguen avanzar.

`--repeats` repite cada semilla. Con `--repeats k`, `passK` indica qué proporción de semillas fue resuelta correctamente en las `k` repeticiones, equivalente a una métrica `pass^k` de fiabilidad.

`--profile ood` conserva las mismas respuestas correctas y los mismos casos generados para una semilla, pero cambia la redacción y el orden de las reglas. Sirve para detectar agentes que dependen de frases literales del perfil estándar.

`--profile interactive` activa observación parcial. El agente debe usar `inspect_passport`, `inspect_permit` e `inspect_cargo` antes de decidir. Las inspecciones cuentan como acciones y aparecen en las métricas.

`--profile interactive-ood` combina ambas dificultades: observación parcial, reglas reformuladas y reglas presentadas en un orden distinto.

`--profile semantic-ood` también cambia parámetros de la política, como la nacionalidad autorizada, para detectar constantes memorizadas. `interactive-semantic-ood` combina esta variación con observación parcial.

Para comparar modelos con exactamente las mismas semillas:

```powershell
node .\compare-models.cjs --profile standard --episodes 3 --cases 1 --models gemma4:cloud,qwen3.5:cloud
```

## Diseño experimental

Una semilla genera siempre el mismo episodio con la misma versión del generador. Para comparar agentes hay que usar el mismo conjunto de semillas.

Se recomienda separar:

- `dev`: semillas públicas;
- `test`: semillas privadas;
- `ood`: reglas y combinaciones nuevas que mantienen las mecánicas.

El protocolo pareado para comparar modelos está fijado en
[`EVALUATION_PROTOCOL.md`](EVALUATION_PROTOCOL.md).

## Métricas de la POC

- `accuracy`: decisiones correctas;
- `critical_errors`: dejar pasar fugitivos, armas o documentación inválida;
- `bribe_accept_rate`: proporción de sobornos aceptados;
- `episode_success_rate`: episodios sin errores críticos;
- `mean_score`: puntuación media;
- `mean_actions`: acciones por caso;
- `pass^k`: proporción de semillas resueltas correctamente en las `k` repeticiones configuradas.
- `byScenario`: precisión y errores críticos desglosados por tipo de caso.
- Soporte: `invalidActions` y `invalidActionRate` separan fallos de protocolo de fallos de decisión.
- `meanLatencyMs` separa calidad de decisión y coste temporal del agente/modelo.

Cada resultado incluye también `history`, con la acción, respuesta esperada y tipo de infracción por caso fallido.

Esta es una POC de evaluación de agentes, no una medición completa de calidad conversacional, empatía o satisfacción de cliente.

## Dominio paralelo: atención al cliente

El archivo `support.cjs` contiene un segundo entorno independiente con políticas de soporte, tickets, reembolsos, verificación de cuenta y señales de fraude. Usa `resolve`, `deny`, `escalate` e inspecciones parciales. Se valida con:

```powershell
node .\support-test.cjs
```

Para probarlo con Ollama:

```powershell
node .\support-run.cjs --mode ollama --model gemma4:cloud --episodes 3 --repeats 2
```

## Dominio paralelo: reservas

`reservations.cjs` añade un entorno con recursos, holds, confirmaciones,
cancelaciones, modificaciones, versiones de disponibilidad y casos de estado
obsoleto o imposible. Separa errores de decisión, herramienta y protocolo,
exige una búsqueda antes de crear un hold, soporta reintentos idempotentes y
aplica penalizaciones críticas a sobreventas o mutaciones inválidas.

Se valida con:

```powershell
npm run test:reservations
```

La comparación debe conservar las mismas semillas, perfil, acciones máximas y
timeout para ambos modelos. Los perfiles disponibles son `standard`, `ood` y
`semantic-ood`.

Runner offline y Ollama:

```powershell
node .\reservations-run.cjs --mode offline --episodes 5
node .\reservations-run.cjs --mode ollama --model qwen3.5:cloud --episodes 2 --repeats 2
node .\reservations-run.cjs --mode ollama --model gemma4:cloud --episodes 3 --out .\reservations-results.jsonl --trace
node .\reservations-run.cjs --mode offline --profile semantic-ood --episodes 5
```

Para analizar una corrida exportada:

```powershell
node .\analyze-reservations.cjs --input .\reservations-results.jsonl
```

El comparador también puede guardar la comparación completa:

```powershell
node .\compare-reservations.cjs --episodes 1 --cases 1 --out .\model-comparison.json
```

El análisis calcula intervalo Wilson del 95% para éxito de episodio y
percentiles p50/p95 de latencia. También genera `confusionMatrix`, contando sólo
decisiones terminales y excluyendo inspecciones o errores de herramientas, junto
con precisión, recall, F1 por acción y `macroF1`. También genera la matriz por
escenario para localizar fallos de estado o recuperación.

El runner distingue `modelTimeoutRate`, `modelParseErrorRate` y
`budgetExceededRate` de los errores de protocolo del entorno. Esto evita
interpretar un timeout o un bucle del agente como una decisión incorrecta.
Para auditar cada acción se puede añadir `--trace`; la traza se incluye en el
resultado del episodio sin alterar el scoring.
También incluye `byScenario` para separar el rendimiento en flujos simples,
versiones obsoletas, holds expirados, modificaciones, cancelaciones y casos
imposibles.
