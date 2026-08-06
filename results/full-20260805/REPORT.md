# Corrida de calibración — 2026-08-05

## Alcance

Se ejecutó una corrida representativa de `deepseek-v4-pro:cloud`,
`gpt-oss:20b-cloud` y `gpt-oss:120b-cloud` en cinco celdas:

- frontera estándar;
- frontera `interactive-semantic-ood`;
- atención al cliente;
- reservas estándar;
- reservas `semantic-ood`.

Cada celda contiene un episodio. La corrida mide viabilidad, trazabilidad y
patrones de error; no constituye una comparación estadística concluyente.

## Resultados

| Modelo | Frontera estándar | Frontera interactiva/OOD | Soporte | Reservas estándar | Reservas semantic-OOD |
| --- | --- | --- | --- | --- | --- |
| DeepSeek V4 Pro | éxito, 100%, 8.8 s | éxito, 100%, 5.7 s | éxito, 100%, 82.6 s | 0%, presupuesto agotado, 37.0 s | 0%, `search_required`, 14.7 s |
| GPT-OSS 20B | éxito, 100%, 3.3 s | éxito, 100%, 12.1 s | 50%, 50.6 s | 0%, presupuesto agotado, 21.8 s | 0%, `search_required`, 2.4 s |
| GPT-OSS 120B | éxito, 100%, 5.8 s | éxito, 100%, 5.1 s | 50%, 41.9 s | 0%, presupuesto agotado, 41.2 s | 0%, `search_required`, 5.3 s |

## Diagnóstico

Todos los modelos resolvieron las celdas de frontera incluidas. DeepSeek fue
el único que resolvió el episodio completo de soporte. Los tres modelos fallaron
en reservas al intentar `create_hold` sin la precondición `search`; en las
celdas estándar el patrón se repitió hasta agotar el presupuesto.

Las métricas de reservas separan correctamente este fallo de herramienta de un
error de decisión, timeout o parseo de salida.

## Limitaciones de esta corrida

Las semillas no fueron idénticas entre modelos (`400xx`, `401xx` y `402xx`).
Por ello no se deben comparar numéricamente sus latencias, precisión o éxito
como si fueran resultados pareados. La próxima batería debe fijar exactamente
las mismas semillas, perfiles, límites de acción y timeout para cada modelo,
usar múltiples repeticiones y reportar intervalos de confianza.
