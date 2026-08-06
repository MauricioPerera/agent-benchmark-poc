# Resultados del protocolo v1

Ejecución pareada terminada el 2026-08-05 para `deepseek-v4-pro:cloud`,
`gpt-oss:20b-cloud` y `gpt-oss:120b-cloud`. Cada modelo recibió las mismas
semillas, perfiles y presupuesto dentro de cada suite. El detalle reproducible
está en `report.json` y la secuencia de ejecución en `stdout.log`.

| Suite | DeepSeek V4 Pro | GPT-OSS 20B | GPT-OSS 120B |
| --- | ---: | ---: | ---: |
| Border, estándar (accuracy) | 100.0% | 100.0% | 97.8% |
| Border, interactivo + OOD semántico (accuracy) | 93.3% | 90.0% | 63.3% |
| Soporte (accuracy) | 94.4% | 42.2% | 58.9% |
| Soporte (éxito de episodio) | 93.3% | 0.0% | 0.0% |
| Reservations, estándar (accuracy) | 1.1% | 0.0% | 3.3% |
| Reservations, OOD semántico (accuracy) | 0.0% | 0.0% | 0.0% |

## Lectura

- **Border:** los tres modelos resuelven la política directa. Bajo observación
  parcial y reglas parafraseadas, DeepSeek conserva la mayor exactitud; 120B
  cae más que 20B, por lo que tamaño no predice robustez en esta mecánica.
- **Soporte:** DeepSeek separa correctamente `resolver`, `escalar` y `denegar`.
  GPT-OSS 20B confunde de forma recurrente los casos de escalamiento y las
  denegaciones con `resolver`; 120B mejora escalamiento, pero todavía convierte
  muchas denegaciones en resolución.
- **Reservations:** todos los modelos agotan el presupuesto de acciones con
  frecuencia (73.3%--100%) y no completan episodios. Es una señal de dificultad
  de control de herramientas, no una medición final comparable por tipo.

## Limitación conocida y corrección aplicada

Esta corrida detectó que, en Reservations, un fallo terminal detenía el resto
de las reservas del episodio. Eso concentró los registros observados en el
primer tipo (`simple`) y ocultó los demás mecanismos. Posteriormente se cambió
el entorno para que cada reserva sea una tarea independiente: el error se
penaliza, pero el episodio avanza a la siguiente reserva. Las pruebas confirman
cobertura de los seis tipos (`simple`, `stale`, `expired_hold`,
`modify_conflict`, `cancel`, `impossible`) con el oráculo.

Por ello, los resultados de **Border** y **Soporte** de esta corrida son la
línea base pareada v1; los de **Reservations** deben repetirse con la mecánica
corregida antes de usarse para comparar modelos.
