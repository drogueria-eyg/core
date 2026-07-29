# Cómo regenerar el universo oficial (universo-salud.json)

El tablero cruza nuestros clientes con el padrón oficial de farmacias e
instituciones de salud. Ese padrón se publica cada tanto; para actualizarlo:

1. Bajar los dos archivos del Ministerio de Salud (buscar la versión más nueva en
   https://datos.gob.ar → "Listado de Establecimientos de Farmacias" y
   "Listado Establecimientos de Salud ... (REFES)"), guardarlos como
   `refar.xlsx` y `refes.xlsx`.
2. Descomprimirlos (un .xlsx es un .zip) en las carpetas `refar/` y `refes/`.
3. Bajar los centroides de localidades del servicio oficial de georreferenciación:
   https://apis.datos.gob.ar/georef/api/localidades?campos=id,nombre,centroide,provincia&max=5000
   guardándolo como `loc1.json`.
4. Exportar nuestros clientes de Odoo a `p_parts.json` (res.partner con
   name, city, state_id, partner_latitude/longitude, category_id, create_date).
5. Correr, en orden:
       node universo.mjs     # ubica cada establecimiento en su localidad
       node match2.mjs       # cruza con nuestros clientes (criterio conservador)
       node construir.mjs    # arma universo-salud.json

El cruce por nombre es deliberadamente **conservador**: prefiere no marcar a
marcar de más. Los totales por localidad (que son los que mandan en los números
del tablero) salen de contar, no del cruce de nombres.
