import { SPECS } from './specs.js';

export function mmToPx(mm, dpi=300) { return Math.round(mm * dpi / 25.4); }

export function computeCrop(spec, det, imgW, imgH, adjust={}) {
  const scale=adjust.scale ?? 1, dyMm=adjust.dyMm ?? 0;
  const headPx=det.chinY-det.crownY;
  const pxPerMm=headPx/(spec.headTargetMm*scale);
  const w=spec.widthMm*pxPerMm, h=spec.heightMm*pxPerMm;
  let y=spec.id==='us-passport' ? det.eyeY-(h-(31.75*pxPerMm)) : det.crownY-((spec.heightMm-spec.headTargetMm)*0.4*pxPerMm);
  y+=dyMm*pxPerMm; // dyMm>0 = 얼굴을 위로(자르는 틀을 아래로)
  const x=det.centerX-w/2;
  const headMm=headPx/pxPerMm;
  const eyeFromBottomMm=(y+h-det.eyeY)/pxPerMm;
  const problems=[];
  if(headMm<spec.headMinMm || headMm>spec.headMaxMm) problems.push(headMm>spec.headMaxMm?'얼굴이 너무 큽니다':'얼굴이 너무 작습니다');
  if(spec.eyeMinMm && (eyeFromBottomMm<spec.eyeMinMm || eyeFromBottomMm>spec.eyeMaxMm)) problems.push('눈 높이가 규격 범위를 벗어났습니다');
  if(det.crownUncertain) problems.push('원본 사진에서 머리 윗부분이 잘린 것 같습니다');
  const crownOut=(det.crownY-y)/h*spec.heightMm, chinOut=(det.chinY-y)/h*spec.heightMm;
  if(crownOut<1 || chinOut>spec.heightMm-1) problems.push('머리가 사진 밖으로 나갔습니다');
  const whitePadding=x<0||y<0||x+w>imgW||y+h>imgH;
  if(whitePadding && !adjust.replaceBackground) problems.push('원본에 여백이 부족해 흰 띠가 생겼습니다');
  return {x,y,w,h,headMm,eyeFromBottomMm,whitePadding,ok:problems.length===0,problems};
}

export function computeSheet(spec) {
  const w=mmToPx(spec.widthMm), h=mmToPx(spec.heightMm), candidates=[];
  for(const orientation of ['landscape','portrait']) for(const gap of [24,0]) {
    const W=orientation==='landscape'?1800:1200, H=orientation==='landscape'?1200:1800;
    const tileW=w, tileH=h;
    const cols=Math.floor((W+gap)/(tileW+gap)), rows=Math.floor((H+gap)/(tileH+gap));
    candidates.push({orientation,gap,W,H,cols,rows,count:cols*rows,tileW,tileH});
  }
  candidates.sort((a,b)=>b.count-a.count||b.gap-a.gap||(a.orientation==='landscape'?-1:1));
  const best=candidates[0], tiles=[];
  const totalW=best.cols*best.tileW+(best.cols-1)*best.gap, totalH=best.rows*best.tileH+(best.rows-1)*best.gap;
  for(let row=0;row<best.rows;row++) for(let col=0;col<best.cols;col++) tiles.push({x:(best.W-totalW)/2+col*(best.tileW+best.gap),y:(best.H-totalH)/2+row*(best.tileH+best.gap),w:best.tileW,h:best.tileH});
  return {...best,tiles,candidates};
}

export async function pickQuality(sizeFn, maxBytes) {
  const qualities=[...Array(13)].map((_,i)=>0.92-i*0.05).concat(0.30);
  for(const quality of qualities) { const result=await sizeFn(quality); if(result.size<=maxBytes) return {ok:true,quality,...result}; }
  const quality=0.30, result=await sizeFn(quality);
  return {ok:false,quality,...result};
}
