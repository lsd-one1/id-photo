import { SPECS, getSpec } from './specs.js';
import { computeCrop } from './layout.js';
import { init, detect, backgroundStats } from './vision.js';
import { makeSingle, makeSheet, makeReference, download } from './render.js';

const $=id=>document.getElementById(id), fileInput=$('photo'), specSelect=$('spec'), background=$('background');
let chosenFile=null, sequence=0, selectedSpec=SPECS[0], adjustment={scale:1,dyMm:0,replaceBackground:false},result=null,initPromise=null;
for(const spec of SPECS){const option=document.createElement('option');option.value=spec.id;option.textContent=`${spec.name} (${spec.widthMm}×${spec.heightMm}mm)`;specSelect.append(option);}
function expose(value){const frozen=structuredClone(value);for(const item of Object.values(frozen)) if(item&&typeof item==='object')Object.freeze(item);Object.freeze(frozen);Object.defineProperty(window,'__idphoto',{value:frozen,configurable:true,writable:false});}
function clearResult(){result=null;$('preview-wrap').classList.add('hidden');for(const id of ['single','sheet','reference'])$(id).disabled=true;}
function message(text){$('status').textContent=text;}
async function ensureVision(){if(!initPromise)initPromise=init().catch(error=>{initPromise=null;throw error;});return initPromise;}
function scaledBitmap(bitmap){const k=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*k),h=Math.round(bitmap.height*k);if(k===1)return {bitmap,k,w,h,close:()=>{}};const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(bitmap,0,0,w,h);return {bitmap:canvas,k,w,h,close:()=>{}};}
async function process(){const current=++sequence;clearResult();$('retry').classList.add('hidden');if(!chosenFile){message('사진을 선택해 주세요.');return;}
  try{
    message('사진을 분석하고 있습니다. 처음에는 모델을 내려받습니다.');await ensureVision();if(current!==sequence)return;
    let upright;try{upright=await createImageBitmap(chosenFile,{imageOrientation:'from-image'});}catch{throw new Error('이미지 파일을 열 수 없습니다 (아이폰 사진은 JPG로 바꿔 올려 주세요)');}
    const work=scaledBitmap(upright);if(work.bitmap!==upright)upright.close?.();const det=detect(work.bitmap);if(current!==sequence){work.close();return;}
    if(det.faces===0)throw new Error('얼굴을 찾지 못했습니다. 정면 사진을 올려 주세요');if(det.faces>=2)throw new Error('한 사람만 나온 사진을 올려 주세요');
    const crop=computeCrop(selectedSpec,det,work.w,work.h,adjustment);const bgReplaced=adjustment.replaceBackground&&!!det.mask;const single=await makeSingle(work.bitmap,selectedSpec,crop,det,bgReplaced);if(current!==sequence){work.close();return;}
    const bgStats=backgroundStats(work.bitmap,det.mask,crop);result={single,det,crop,work};work.close();
    const warnings=[...crop.problems];if(det.crownEstimated)warnings.push('머리 위치를 추정했습니다. 직접 확인해 주세요');if(det.crownY!==null&&det.chinY-det.crownY<200)warnings.push('해상도가 낮아 인화 품질이 떨어질 수 있습니다');
    if(selectedSpec.background==='forbidden'&&(bgStats.mean<200||bgStats.std>25))warnings.push('배경이 흰색 단색이 아닙니다. 흰 벽 앞에서 다시 찍는 것을 권합니다');
    if(adjustment.replaceBackground&&!bgReplaced)warnings.push('사람 영역을 찾지 못해 배경을 바꾸지 못했습니다');
    if(bgReplaced)warnings.push('기관에 따라 배경 합성 사진을 받지 않을 수 있습니다');
    const preview=$('preview');preview.width=single.canvas.width;preview.height=single.canvas.height;preview.getContext('2d').drawImage(single.canvas,0,0);
    const list=$('warnings');list.replaceChildren(...warnings.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    $('size-warning').textContent=single.ok?'':`용량 상한(${Math.round(selectedSpec.maxBytes/1024)}KB)을 맞추지 못했습니다`;
    $('single').disabled=!single.ok;$('sheet').disabled=!single.ok;$('reference').disabled=single.ok;
    $('preview-wrap').classList.remove('hidden');message('완료했습니다. 경고가 있으면 내용을 확인해 주세요.');
    expose({fileName:chosenFile.name,specId:selectedSpec.id,uprightW:Math.round(work.w/work.k),uprightH:Math.round(work.h/work.k),k:work.k,det:{crownY:det.crownY,chinY:det.chinY,eyeY:det.eyeY,centerX:det.centerX,crownUncertain:det.crownUncertain,crownEstimated:det.crownEstimated},crop:{x:crop.x,y:crop.y,w:crop.w,h:crop.h},outW:single.canvas.width,outH:single.canvas.height,headMm:crop.headMm,eyeFromBottomMm:crop.eyeFromBottomMm,ok:crop.ok,problems:crop.problems,bgReplaced,quality:single.quality,bytes:single.blob.size});
  }catch(error){if(current!==sequence)return;const text=error.message.includes('Failed to fetch')||error.message.includes('fetch')?'처음 한 번은 인터넷이 필요합니다':error.message;message(text);expose({fileName:chosenFile.name,error:text});if(text==='처음 한 번은 인터넷이 필요합니다')$('retry').classList.remove('hidden');}
}
function queue(){if(chosenFile)process();}
fileInput.addEventListener('change',()=>{chosenFile=fileInput.files?.[0]??null;queue();});
specSelect.addEventListener('change',()=>{selectedSpec=getSpec(specSelect.value);background.checked=selectedSpec.replaceDefault;adjustment.replaceBackground=selectedSpec.background==='optional'&&background.checked;$('background-label').classList.toggle('hidden',selectedSpec.background==='forbidden');$('rule').textContent=selectedSpec.background==='forbidden'?'여권 사진은 규정상 배경 합성을 하지 않습니다.':'배경을 흰색으로 바꿀 수 있습니다.';$('bg-note').textContent=selectedSpec.background==='optional'&&background.checked?'기관에 따라 배경 합성 사진을 받지 않을 수 있습니다':'';queue();});
background.checked=false;
background.addEventListener('change',()=>{adjustment.replaceBackground=selectedSpec.background==='optional'&&background.checked;queue();});
$('scale').addEventListener('input',event=>{$('scale-value').textContent=`${Math.round(Number(event.target.value)*100)}%`;adjustment.scale=Number(event.target.value);queue();});
$('up').addEventListener('click',()=>{adjustment.dyMm+=1;queue();});$('down').addEventListener('click',()=>{adjustment.dyMm-=1;queue();});$('retry').addEventListener('click',()=>queue());
$('single').addEventListener('click',()=>result&&download(result.single.blob,`${selectedSpec.id}.jpg`));$('sheet').addEventListener('click',async()=>result&&download((await makeSheet(result.single,selectedSpec)).blob,`${selectedSpec.id}-sheet.jpg`));$('reference').addEventListener('click',async()=>result&&download((await makeReference(result.single)).blob,`${selectedSpec.id}-reference.jpg`));
specSelect.dispatchEvent(new Event('change'));
