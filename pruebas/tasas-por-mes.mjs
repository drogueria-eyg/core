/* ¿Cada mes usa la tasa que regía entonces? Se saca tasasDe/reglasDe TAL CUAL están en core.js. */
import fs from "fs";
/* Se corre desde la raiz del repo:  node pruebas/tasas-por-mes.mjs
   No toca Odoo ni la red: saca tasasDe y reglasDe TAL CUAL estan en core.js y les da meses. */
import { fileURLToPath } from "url";
const R=fileURLToPath(new URL("../",import.meta.url));
const src=fs.readFileSync(R+"assets/core.js","utf8");
function sacar(s,firma){ const i=s.indexOf(firma); let j=s.indexOf("{",i),n=0,k=j;
  for(;k<s.length;k++){ const ch=s[k];
    if(ch==="{")n++; else if(ch==="}"){n--; if(!n)break;}
    else if(ch==='"'||ch==="'"||ch==="`"){const q=ch;k++;while(k<s.length&&s[k]!==q){if(s[k]==="\\")k++;k++;}} }
  return s.slice(i,k+1); }
const cfgTxt=sacar(src,"const COMI_DEF=").replace(/^const COMI_DEF=/,"").replace(/\/\*[\s\S]*?\*\//g,"");
const COMI_DEF=eval("("+cfgTxt+")");
let _comiCfg=null;
const paqueteRige=(m,c)=>!c.paqueteDesde||String(m)>=String(c.paqueteDesde);
/* como expresion: una declaracion dentro de eval no queda visible afuera en un modulo */
const tasasDe=eval("("+sacar(src,"function tasasDe(")+")");
const reglasDe=eval("("+sacar(src,"function reglasDe(")+")");

const P=o=>(o.base*100).toFixed(1).replace(".",",")+"/"+(o.high*100).toFixed(1).replace(".",",")+"%";
/* la config como va a quedar: 2,5/3,5 antes de octubre, 2,3/2,8 desde octubre */
const cfg=Object.assign({},COMI_DEF,{
  paqueteDesde:"2026-10",
  rates:{inst:{base:.02,high:.03},farm:{base:.023,high:.028},externo:{base:.03,high:.04}},
  ratesHist:[{desde:"2026-10",rates:{inst:{base:.02,high:.03},farm:{base:.023,high:.028},externo:{base:.03,high:.04}}}],
  reglasPrevias:{metaMetodo:"mediana",metaCrecimiento:0.20,metaMeses:3,metaCuentaVacios:true,
    rates:{inst:{base:.02,high:.03},farm:{base:.025,high:.035},externo:{base:.03,high:.04}}},
});
console.log("QUE TASA DE FARMACIAS USA CADA MES\n");
const esperado={"2026-07":"2,5/3,5%","2026-08":"2,5/3,5%","2026-09":"2,5/3,5%","2026-10":"2,3/2,8%","2026-11":"2,3/2,8%"};
let mal=0;
for(const m of Object.keys(esperado)){
  const r=P(reglasDe(m,cfg).rates.farm), ok=r===esperado[m]; if(!ok)mal++;
  console.log("  "+(ok?"✓":"✗")+" "+m+"   "+r+(ok?"":"   ESPERABA "+esperado[m]));
}
/* y ahora Dirección cambia la tasa en diciembre: octubre y noviembre NO se pueden mover */
const cfg2=JSON.parse(JSON.stringify(cfg));
cfg2.ratesHist.push({desde:"2026-12",rates:{inst:{base:.02,high:.03},farm:{base:.019,high:.025},externo:{base:.03,high:.04}}});
cfg2.rates.farm={base:.019,high:.025};
console.log("\nSI EN DICIEMBRE SE BAJA A 1,9/2,5%\n");
const esp2={"2026-09":"2,5/3,5%","2026-10":"2,3/2,8%","2026-11":"2,3/2,8%","2026-12":"1,9/2,5%","2027-01":"1,9/2,5%"};
for(const m of Object.keys(esp2)){
  const r=P(reglasDe(m,cfg2).rates.farm), ok=r===esp2[m]; if(!ok)mal++;
  console.log("  "+(ok?"✓":"✗")+" "+m+"   "+r+(ok?"":"   ESPERABA "+esp2[m]));
}
/* sin historia cargada, se comporta como antes */
const cfg3=JSON.parse(JSON.stringify(cfg)); cfg3.ratesHist=[];
const r3=P(reglasDe("2026-10",cfg3).rates.farm);
console.log("\n  sin epocas cargadas, octubre usa las tasas de hoy: "+r3+(r3==="2,3/2,8%"?"   ✓":"   ✗"));
if(r3!=="2,3/2,8%") mal++;
console.log("\n"+(mal?"⚠ "+mal+" casos mal":"✓ cada mes se calcula con la tasa que regia entonces"));
process.exit(mal?1:0);
