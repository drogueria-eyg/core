/* Corre todas las pruebas, una atrás de otra:  node pruebas/todas.mjs
   Cada una vive en su propio proceso: así una que rompa el entorno —se arma un navegador falso
   en globalThis— no puede ensuciar a la siguiente. */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const archivos = fs.readdirSync(DIR).filter(f=>f.endsWith(".mjs") && f!=="todas.mjs").sort();

let fallaron=[];
for(const f of archivos){
  console.log("\n────────  "+f+"  ────────");
  const r = spawnSync(process.execPath, [DIR+f], { stdio:"inherit" });
  if(r.status!==0) fallaron.push(f);
}
console.log("\n════════════════════════════════════════");
if(fallaron.length){
  console.log("⚠ FALLARON: "+fallaron.join(", "));
  console.log("No publiques hasta que estén en verde.");
}else{
  console.log("✓ las "+archivos.length+" pruebas pasan");
}
process.exit(fallaron.length?1:0);
