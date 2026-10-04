import { CDN_BASE, WASM_URL, FACE_MODEL_URL, SEGMENT_MODEL_URL } from './config.js';

let visionTasks, faceLandmarker, segmenter;
export async function init() {
  if(faceLandmarker && segmenter) return;
  const api=await import(`${CDN_BASE}vision_bundle.mjs`);
  visionTasks=api;
  const files=await api.FilesetResolver.forVisionTasks(WASM_URL);
  [faceLandmarker,segmenter]=await Promise.all([
    api.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:FACE_MODEL_URL},runningMode:'IMAGE',numFaces:2}),
    api.ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:SEGMENT_MODEL_URL},runningMode:'IMAGE',outputCategoryMask:false,outputConfidenceMasks:true})
  ]);
}
export function detect(bitmap) {
  const result=faceLandmarker.detect(bitmap), faces=result.faceLandmarks ?? [];
  if(faces.length!==1) return {faces:faces.length};
  const points=faces[0], chin=points[152], forehead=points[10], eye=(points[33].y+points[263].y+points[133].y+points[362].y)/4;
  const centerX=(points[1].x+chin.x)/2*bitmap.width, chinY=chin.y*bitmap.height, eyeY=eye*bitmap.height;
  const faceWidth=Math.abs(points[234].x-points[454].x)*bitmap.width, start=Math.max(0,Math.floor(centerX-faceWidth/4)), end=Math.min(bitmap.width-1,Math.ceil(centerX+faceWidth/4));
  let mask=null,crownY=null,crownUncertain=false,crownEstimated=false;
  const segmented=segmenter.segment(bitmap), personMask=segmented.confidenceMasks?.[0];
  if(personMask) {
    const data=personMask.getAsFloat32Array().slice(); segmented.close?.(); mask={data,width:bitmap.width,height:bitmap.height};
    for(let y=0;y<bitmap.height&&crownY===null;y++) for(let x=start;x<=end;x++) if(data[y*bitmap.width+x]>0.5){crownY=y;break;}
    if(crownY!==null) crownUncertain=crownY<=2;
  }
  if(crownY===null){crownY=(forehead.y*bitmap.height)-((chinY-forehead.y*bitmap.height)*0.12);crownEstimated=true;}
  return {faces:1,chinY,crownY,crownUncertain,crownEstimated,eyeY,centerX,mask,faceWidth};
}
// 출력에 실제로 들어가는 영역(crop) 안의 배경 픽셀만 본다. 원본 바깥쪽 물건 때문에 경고가 뜨지 않게.
export function backgroundStats(bitmap,mask,crop) {
  const x0=Math.max(0,Math.floor(crop.x)),y0=Math.max(0,Math.floor(crop.y)),x1=Math.min(bitmap.width,Math.ceil(crop.x+crop.w)),y1=Math.min(bitmap.height,Math.ceil(crop.y+crop.h));
  if(x1<=x0||y1<=y0) return {mean:255,std:0};
  const canvas=new OffscreenCanvas(x1-x0,y1-y0),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,-x0,-y0);
  const pixels=ctx.getImageData(0,0,x1-x0,y1-y0).data, samples=[];
  for(let y=y0;y<y1;y+=4) for(let x=x0;x<x1;x+=4) if(!mask || mask.data[y*bitmap.width+x]<=0.5){const p=((y-y0)*(x1-x0)+(x-x0))*4;samples.push((pixels[p]+pixels[p+1]+pixels[p+2])/3);}
  if(!samples.length) return {mean:255,std:0};
  const mean=samples.reduce((a,b)=>a+b,0)/samples.length;
  return {mean,std:Math.sqrt(samples.reduce((a,b)=>a+(b-mean)**2,0)/samples.length)};
}
