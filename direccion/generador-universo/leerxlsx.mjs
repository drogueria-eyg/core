import fs from 'fs';
/* Lee una hoja xlsx con strings en línea (formato de los archivos del Min. de Salud).
   Streaming simple por regex de filas: los archivos son grandes pero la estructura es plana. */
export function leerHoja(path){
  const xml = fs.readFileSync(path,'utf8');
  const filas = [];
  const reRow = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const reCell = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g;
  const des = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  const colIdx = c => { let n=0; for(const ch of c) n=n*26+(ch.charCodeAt(0)-64); return n-1; };
  let m;
  while((m = reRow.exec(xml))){
    const cells=[]; let c;
    reCell.lastIndex=0;
    while((c = reCell.exec(m[1]))){
      const i=colIdx(c[1]); const body=c[2]||"";
      let v="";
      const t=/<t[^>]*>([\s\S]*?)<\/t>/.exec(body); const v2=/<v>([\s\S]*?)<\/v>/.exec(body);
      if(t) v=des(t[1]); else if(v2) v=des(v2[1]);
      cells[i]=v;
    }
    filas.push(cells);
  }
  return filas;
}
