# Resultados

Esta carpeta contiene corridas reales contra Ollama, en el orden en que se
fueron ejecutando. Si buscás el estado actual del benchmark, empezá por acá:

- **[protocol-v1-full-20260806/](protocol-v1-full-20260806/REPORT.md)** —
  protocolo v1 completo de frontera y soporte (15 episodios por celda, mismas
  semillas para los tres modelos). Es el resultado pareado más reciente de
  esos dos dominios.
- **[reservations-v1-fix7-validation-20260806/](reservations-v1-fix7-validation-20260806/REPORT.md)** —
  estado actual del dominio de reservas, tras la investigación descrita abajo.

## Rastro de la investigación (reservas)

El dominio de reservas partió con 0-17% de accuracy y ningún episodio
completo. Cada carpeta `reservations-v1-fix*-validation-20260806/` documenta
una iteración de diagnóstico y corrección, en orden:

1. `reservations-v1-pilot-20260806/` — piloto inicial, aísla `search_required`
   como fallo dominante.
2. `reservations-v1-fix-validation-20260806/` a `fix3-.../` — reglas
   explícitas de protocolo (precondición de `search`, no repetir acciones
   exitosas). Reducen `search_required` pero exponen loops de repetición.
3. `reservations-v1-fix4-.../` y `fix5-.../` — hallazgo de causa raíz: la
   observación nunca comunicaba el resultado de la última acción al agente,
   por lo que ninguna regla de texto podía cortar los loops.
4. `reservations-v1-fix6-.../` — fix real (`last_action` expuesto en la
   observación): `budget_exceeded` pasa de 6/6 a 0/6 corridas.
5. `reservations-v1-fix7-.../` — `stale_version` y `hold_expired` pasan de
   errores que cerraban el caso a errores recuperables dentro de la misma
   reserva.

## Otras carpetas

- `full-20260805/` y `protocol-v1-rerun-20260805/` — primeras corridas
  pareadas, previas a la corrección del dominio de reservas (sus resultados
  de frontera y soporte siguen siendo válidos; los de reservas no).

Cada carpeta con más de un archivo trae un `REPORT.md` con el detalle en
prosa; `report.json`/`report-*.json` son los datos crudos, y
`trace-*.jsonl` son trazas acción por acción cuando se corrió con `--trace`.
