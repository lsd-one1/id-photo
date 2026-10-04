# 증명사진어플 메모

사진 → 증명·여권사진 변환 정적 웹페이지. 빌드 없음, 서버 없음(모든 처리는 브라우저 안).
얼굴 찾기·사람 영역 분리는 MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN, 모델은 storage.googleapis.com).

## 지금 상태

v0.1.0. 기획 `.pipeline/plan.md`(astra 3라운드 승인) → luna 구현 → 직접 수정·테스트 →
sol 코드 심사 2라운드 승인. 단위 10건·브라우저 e2e 183건 통과.

폰용 공개 주소: https://lsd-one1.github.io/id-photo/ (저장소 lsd-one1/id-photo, 공개).
GitHub Pages 는 지금 **`feat/id-photo` 브랜치**에서 나간다 — main 에 머지하면 Pages 원본도
main 으로 바꿀 것 (`gh api -X PUT repos/lsd-one1/id-photo/pages -f "source[branch]=main" -f "source[path]=/"`).
push 하면 1분 안에 주소에 반영된다.

## 막힌 것 / 사람이 봐야 할 것

- **흰 배경 사진으로는 아직 실제 확인을 못 했다.** 공개 검증 사진 3장이 전부 색 배경(성조기 등)이라,
  여권 규격에서 "흰 배경이면 경고가 안 뜨는지"는 실제 흰 벽 사진으로 사람이 확인해야 한다.
- face1 은 미국 규격에서 원본 위 여백이 모자라 "흰 띠" 경고가 뜬다 — 정상 동작.

## 실행 명령

```
python -m http.server 8765            # 열기: http://localhost:8765/
node --test tests/layout.test.mjs     # 단위(Node 24 는 `node --test tests/` 가 실패한다)
python tests/e2e.py                   # 브라우저 e2e (Playwright·PIL 필요, 공개 사진은 SOURCES.md 대로 받아 둔다)
E2E_DEBUG=<폴더> python tests/e2e.py   # 모서리 비교 실패 시 앱 출력·기대 그림을 그 폴더에 남김
```

## 이번에 밟은 함정

- **정답표(labels.json)가 틀릴 수 있다.** 에이전트가 축소 사진을 눈대중으로 찍은 턱 좌표가
  입 아래였다. 검출 오차가 나면 앱보다 먼저 선을 그어 정답표를 의심할 것(face1·face3 수정함).
- **색 프로파일.** face3 은 Adobe RGB 로 저장돼 있어 브라우저는 sRGB 로 바꿔 그리고 PIL 은 안 바꾼다.
  픽셀 비교 테스트는 `ImageCms` 로 sRGB 변환 후 비교해야 한다.
- 무늬 있는 배경은 점 하나끼리 비교하면 안 된다 — PIL BOX 축소 + 15×15 평균, 가장자리 12px 안쪽.
- MediaPipe 는 `INFO: Created TensorFlow Lite XNNPACK delegate` 를 console.error 로 찍는다(무시).
- luna(codex) 샌드박스에서는 브라우저가 `spawn EPERM` 으로 안 떠서 e2e 를 못 돌린다 — 로컬에서 돌린다.
- 위/아래 보정 버튼 부호가 처음에 반대였다(sol 이 잡음). `dyMm>0` = 얼굴을 위로.
