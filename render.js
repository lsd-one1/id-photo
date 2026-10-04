import { mmToPx, computeSheet, pickQuality } from './layout.js';

function canvasOf(width,height){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}
function composite(bitmap,spec,crop,det,replaceBackground){
  const out=canvasOf(mmToPx(spec.widthMm),mmToPx(spec.heightMm)),ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
  const scale=out.width/crop.w;
  ctx.drawImage(bitmap,-crop.x*scale,-crop.y*scale,bitmap.width*scale,bitmap.height*scale);
  if(replaceBackground&&det.mask){
    const temp=canvasOf(bitmap.width,bitmap.height),tc=temp.getContext('2d');tc.drawImage(bitmap,0,0);
    const image=tc.getImageData(0,0,temp.width,temp.height),d=image.data,m=det.mask.data;
    for(let i=0;i<m.length;i++){const alpha=Math.max(0,Math.min(1,(m[i]-.44)/.12));const p=i*4;d[p]=Math.round(255*(1-alpha)+d[p]*alpha);d[p+1]=Math.round(255*(1-alpha)+d[p+1]*alpha);d[p+2]=Math.round(255*(1-alpha)+d[p+2]*alpha);}
    tc.putImageData(image,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(temp,-crop.x*scale,-crop.y*scale,temp.width*scale,temp.height*scale);
  }
  return out;
}
function blob(canvas,quality){return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));}
export async function makeSingle(bitmap,spec,crop,det,replaceBackground){
  const canvas=composite(bitmap,spec,crop,det,replaceBackground);
  const chosen=await pickQuality(async quality=>{const data=await blob(canvas,quality);return {blob:data,size:data.size};},spec.maxBytes);
  return {canvas,...chosen};
}
export async function makeSheet(single,spec){
  const layout=computeSheet(spec),canvas=canvasOf(layout.W,layout.H),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#999';ctx.lineWidth=1;
  for(const tile of layout.tiles){ctx.drawImage(single.canvas,tile.x,tile.y,tile.w,tile.h);ctx.strokeRect(tile.x+.5,tile.y+.5,tile.w-1,tile.h-1);}
  return {canvas,blob:await blob(canvas,.92),layout};
}
export async function makeReference(single){return {blob:await blob(single.canvas,.92)};}
export function download(data,name){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
