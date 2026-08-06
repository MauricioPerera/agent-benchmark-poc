# Reservas — precondición de `search` y hallazgo de loop en `confirm`

## Alcance

Cuatro corridas iterativas de una repetición por modelo/perfil (`deepseek-v4-pro:cloud`,
`gpt-oss:20b-cloud`, `gpt-oss:120b-cloud`; perfiles `standard` y `semantic-ood`; seeds
51300/51400), cada una tras un ajuste puntual de las reglas expuestas al agente en
`reservations.cjs` y del system prompt en `reservations-run.cjs`. Objetivo: eliminar el
fallo sistemático `search_required` (los tres modelos llamaban `create_hold` sin haber
llamado `search` antes) sin degradar el resto del episodio.

## Resultados por iteración (accuracy / motivo dominante de corte)

| Iteración | Cambio | DeepSeek std | GPT-OSS 20B std | GPT-OSS 120B std |
| --- | --- | --- | --- | --- |
| Baseline | — | 17%, `search_required`×5 | 17%, `search_required`×5 | 0%, `search_required`×4 |
| Fix 1 | Regla: hold requiere `search` previo | 0%, presupuesto agotado | 17%, presupuesto agotado | 33%, presupuesto agotado |
| Fix 2 | + "una sola búsqueda alcanza" | 17%, presupuesto agotado | 0%, presupuesto agotado | 17%, presupuesto agotado |
| Fix 3 | + "no repetir acción ya exitosa" | 17%, presupuesto agotado | 33%, sin agotar (18 acciones) | 17%, presupuesto agotado |
| Fix 4 | + "tras `confirm`, `inspect_policy` decide `modify`/`cancel`" | 33%, presupuesto agotado | 17%, presupuesto agotado | 17%, presupuesto agotado |

(Perfil `semantic-ood` muestra el mismo patrón; se omite por espacio.)

## Diagnóstico

`search_required` se eliminó casi por completo (de 4-6/6 casos a 0-1/6). El fix cumplió
su objetivo puntual. Pero cada corrección destapó la misma clase de fallo un paso más
adelante en el flujo `search → create_hold → confirm → [modify|cancel]`:

- Fix 1 expuso un loop de `search` repetido indefinidamente (DeepSeek).
- Fix 2 expuso un loop de `create_hold` repetido (GPT-OSS 20B).
- Fix 3 resolvió ambos, pero expuso un loop de `confirm` repetido en el caso
  `modify_conflict` (reserva 4): el modelo confirma con éxito, la reserva sigue activa
  porque falta llamar `modify`, y el modelo repite `confirm` hasta agotar el presupuesto
  de 30 acciones.
- Fix 4 agregó una regla explícita y verificada en la traza (aparece en `rules`):
  *"si `confirm` tuvo éxito y la reserva sigue activa, consultar `inspect_policy`"*.
  **No cambió el comportamiento.** En dos corridas de verificación con traza completa
  (DeepSeek y GPT-OSS 20B, mismo seed), ninguno de los dos modelos llamó `inspect_policy`
  ni una sola vez; ambos repitieron `confirm` ~20 veces hasta el corte por presupuesto.

## Hallazgo

Con reglas de texto dentro de la observación, un modelo que entra en el patrón "repetir
la última acción exitosa" no lo corta agregando más texto a esa misma lista de reglas —
ni con un modelo grande (DeepSeek) ni con uno chico (GPT-OSS 20B). Tres iteraciones de
parches textuales resolvieron el síntoma en el punto exacto donde se aplicaron y lo
reprodujeron, sin excepción, en el siguiente paso del flujo. Esto se interpreta como una
propiedad del diseño de la tarea (secuencia de pasos sin final observable claramente
distinto de "seguir esperando"), no como una debilidad de un modelo puntual.

Se documenta como hallazgo de la POC y no se sigue parcheando por reglas. Alternativas de
diseño para una futura iteración (no implementadas): que el entorno trate un `confirm`
repetido como error de protocolo en vez de aceptarlo indefinidamente, o que el runner
sugiera explícitamente la próxima acción esperada en vez de dejar que el modelo la infiera
de las reglas.

## Limitaciones de esta corrida

Una repetición por celda; no hay intervalo de confianza. `reservations.cjs` y
`reservations-run.cjs` quedan con las reglas de Fix 1–4 aplicadas (precondición de
`search`, una sola búsqueda, no repetir acción exitosa, `inspect_policy` tras `confirm`)
porque eliminan `search_required` de forma efectiva aunque no resuelvan el loop de
`confirm`.
