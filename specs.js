export const SPECS = [
  { id:'kr-passport', name:'한국 여권', widthMm:35, heightMm:45, headTargetMm:34, headMinMm:32, headMaxMm:36, background:'forbidden', replaceDefault:false, maxBytes:500*1024, source:'passport.go.kr, gov.kr 여권 안내' },
  { id:'kr-id', name:'주민등록증·운전면허', widthMm:35, heightMm:45, headTargetMm:34, headMinMm:32, headMaxMm:36, background:'optional', replaceDefault:true, maxBytes:250*1024, source:'koroad.or.kr' },
  { id:'kr-half', name:'증명·반명함', widthMm:30, heightMm:40, headTargetMm:28, headMinMm:25, headMaxMm:31, background:'optional', replaceDefault:true, maxBytes:500*1024, source:'법정 규격 없음, 관행' },
  { id:'us-passport', name:'미국 여권·비자', widthMm:50.8, heightMm:50.8, headTargetMm:30, headMinMm:25.4, headMaxMm:34.9, eyeMinMm:28.6, eyeMaxMm:34.9, background:'forbidden', replaceDefault:false, maxBytes:240*1024, source:'travel.state.gov' }
];
export const getSpec = id => SPECS.find(spec => spec.id === id);
