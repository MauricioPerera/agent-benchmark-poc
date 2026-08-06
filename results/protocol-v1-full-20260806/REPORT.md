# Protocolo v1 completo — frontera y soporte (2026-08-06)

## Alcance

Corrida pareada completa según `evaluation-protocol.json`: 5 episodios × 3
repeticiones (15 episodios por celda), mismas semillas para los tres modelos
(`deepseek-v4-pro:cloud`, `gpt-oss:20b-cloud`, `gpt-oss:120b-cloud`) en cada
suite. Cierra el protocolo v1 iniciado el 2026-08-05
(`results/protocol-v1-rerun-20260805/`); reservas ya se corrigió y validó por
separado (`results/reservations-v1-fix1..7-validation-20260806/`).

## Resultados — Frontera

| Suite | DeepSeek | GPT-OSS 20B | GPT-OSS 120B |
| --- | ---: | ---: | ---: |
| Estándar (accuracy) | 97.8% | 100% | 97.8% |
| Estándar (pass^3) | 80% | 100% | 100% |
| Interactiva+OOD (accuracy) | 93.3% | 73.3% | 70.0% |
| Interactiva+OOD (errores críticos) | 0 | 2 | 0 |
| Interactiva+OOD (tasa de soborno aceptado) | 8.3% | 50.0% | 58.3% |

## Resultados — Soporte

| Modelo | Accuracy | Éxito de episodio | pass^3 | Tasa de error de decisión |
| --- | ---: | ---: | ---: | ---: |
| DeepSeek | 97.8% | 86.7% | 60% | 2.2% |
| GPT-OSS 20B | 52.2% | 0% | 0% | 41.1% |
| GPT-OSS 120B | 61.1% | 0% | 0% | 33.3% |

Matriz de confusión (fila = acción correcta, columna = acción del modelo):

- **DeepSeek**: `deny → {deny: 22, resolve: 2}` — 2 casos de fraude resueltos
  en vez de denegados, el resto correcto.
- **GPT-OSS 20B**: `deny → {resolve: 21, escalate: 1}` — **casi nunca
  deniega fraude**, lo resuelve como si fuera un ticket normal en 21 de 22
  casos.
- **GPT-OSS 120B**: `deny → {resolve: 21, deny: 1}` — mismo patrón, 21 de 22
  casos de fraude resueltos en vez de denegados.

## Lectura

- **Frontera estándar**: los tres modelos resuelven la política directa con
  precisión alta (97.8-100%).
- **Frontera bajo observación parcial + reglas parafraseadas + parámetros
  cambiados** (`interactive-semantic-ood`): DeepSeek conserva 93.3% de
  accuracy y cero sobornos aceptados relevantes; los dos GPT-OSS caen a
  70-73% de accuracy y **aceptan sobornos en 50-58% de las ofertas**, frente
  al 8.3% de DeepSeek. Tamaño no predice robustez: 120B acepta más sobornos
  que 20B.
- **Soporte**: hallazgo más serio de esta corrida. Los dos modelos GPT-OSS
  no fallan por error de razonamiento entre `escalate`/`resolve` — fallan
  específicamente en la categoría de seguridad: **tratan una señal de fraude
  confirmada como un ticket normal a resolver, en vez de denegarla, en 21 de
  22 casos cada uno**. DeepSeek deniega correctamente 22 de 24. Ningún
  episodio de GPT-OSS (20B ni 120B) cerró sin al menos un error — episodio
  de éxito 0% para ambos, contra 86.7% de DeepSeek.

## Limitación conocida

Igual que la corrida del 2026-08-05, esto es una medición pareada real (misma
semilla/perfil/presupuesto por modelo) pero de una sola batería sin
intervalos de confianza adicionales más allá de `pass^3`. Los JSONL
completos están en `report-border.json` y `report-support-*.json` (uno por
modelo, corridos por separado por la latencia del dominio de soporte).
