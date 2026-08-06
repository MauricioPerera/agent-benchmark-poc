# Reservas — hallazgo: la observación nunca comunica el resultado de la última acción

## Alcance

Continuación de `results/reservations-v1-fix4-validation-20260806/REPORT.md`. Ese
reporte dejó documentado un loop de `confirm` en el escenario `modify_conflict`
que ninguna regla de texto en `rules` o en el system prompt lograba cortar.
Esta iteración (Fix 5) probó un ataque a nivel de motor en vez de texto:
tratar un `confirm` repetido sobre una reserva ya confirmada como error
explícito (`already_confirmed`, `errorType: tool`) — el mismo tratamiento que
ya existía para `inspect_*` repetido — en vez de aceptarlo en silencio como
éxito.

## Resultado

`already_confirmed` aparece 17-20 veces por corrida en las 6 combinaciones de
modelo/perfil (seeds 51300/51400). El error se registra y penaliza
correctamente en las métricas. **El loop no se corta**: las 6 corridas siguen
agotando el presupuesto de 30 acciones sin excepción.

## Diagnóstico (causa raíz encontrada)

Con `--trace` se confirmó que la observación que recibe el agente en el paso
posterior a un `already_confirmed` es **idéntica, byte a byte**, a la del paso
donde ocurrió el error. `observation()` en `reservations.cjs` nunca incluyó
ningún campo con el resultado de la acción anterior (éxito, error, tipo de
error). El valor `{ error, errorType }` que devuelve `step()` se usa para
`history` (metricas) pero el runner (`reservations-run.cjs`) descarta ese
valor de retorno y le arma al modelo una observación nueva vía
`observation(state)`, que no lleva rastro de lo ocurrido.

Esto explica retroactivamente los tres loops encontrados en esta investigación
(`search` repetido, `create_hold` repetido, `confirm` repetido): en ningún
caso el agente tuvo forma de saber que su acción anterior falló o fue
redundante. Ninguna regla de texto en `rules` podía cambiar ese
comportamiento porque no había ninguna señal en la observación que la
activara.

## Hallazgo

El error existe y se computa correctamente desde `reservations.cjs:186-190`
(fix aplicado en esta sesión), pero no está conectado a lo que ve el agente.
Cerrar el loop requeriría un cambio adicional — exponer en `observation()`
el resultado de la última acción (por ejemplo `last_action: { error,
errorType }`) y que el runner lo propague — que queda fuera del alcance
pedido en esta sesión. Se documenta como hallazgo y no se implementa.

## Estado del código tras esta sesión

`reservations.cjs` conserva el chequeo `already_confirmed`: mejora la
fidelidad de las métricas (un `confirm` redundante ahora se contabiliza como
error de herramienta en vez de contar como éxito silencioso) aunque, por sí
solo, no cambia el comportamiento del agente.

## Limitaciones de esta corrida

Una repetición por celda; no hay intervalo de confianza. Mismos seeds/perfil/
presupuesto que las iteraciones Fix 1-4 para comparabilidad directa.
