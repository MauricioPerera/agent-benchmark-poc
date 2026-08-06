# Reservations v1 corregido — piloto

Piloto pareado con una ejecución por modelo y perfil. Cada episodio contiene
los seis escenarios: `simple`, `stale`, `expired_hold`, `modify_conflict`,
`cancel` e `impossible`. El entorno avanza a la siguiente reserva aunque la
actual termine con error, por lo que la cobertura no queda sesgada por el
primer fallo.

| Perfil | Modelo | Accuracy | Éxito episodio | Error de herramienta | Parseo | Latencia media |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| estándar | DeepSeek V4 Pro | 16.7% | 0% | 38.5% | 0% | 69.6 s |
| estándar | GPT-OSS 20B | 16.7% | 0% | 45.5% | 0% | 48.4 s |
| estándar | GPT-OSS 120B | 0% | 0% | 60.0% | 100% | 33.0 s |
| OOD semántico | DeepSeek V4 Pro | 0% | 0% | 66.7% | 0% | 45.8 s |
| OOD semántico | GPT-OSS 20B | 0% | 0% | 75.0% | 0% | 22.7 s |
| OOD semántico | GPT-OSS 120B | 0% | 0% | 50.0% | 100% | 29.7 s |

## Interpretación

- El cuello de botella está en el protocolo operativo: los modelos no
  mantienen de forma fiable la secuencia `search → create_hold → confirm` ni
  sus variantes con actualización, expiración o modificación.
- El caso `impossible` estándar fue resuelto por DeepSeek y GPT-OSS 20B, pero
  no por GPT-OSS 120B debido a una salida no parseable antes de llegar a él.
- El OOD semántico elimina esas pocas resoluciones: la reformulación de
  `resource` a `venue` y de las reglas cambia el rendimiento aunque las
  mecánicas sean equivalentes.

Este es un piloto de una repetición, no una estimación estable de ranking. La
siguiente medición recomendable es repetir con al menos 3 repeticiones y
reportar intervalos de confianza por escenario.
