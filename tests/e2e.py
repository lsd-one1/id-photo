import sys
# 콘솔이 cp949 여도 한글·기호 출력에서 죽지 않게 (다른 PC 에서도 그대로 돈다)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import io
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageCms, ImageOps

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "faces"
BASE = "http://localhost:8765/"
ALLOWED_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/"
FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
SEGMENT_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite"
SPECS = {
    "kr-passport": {"size": (413, 531), "mm": (35, 45), "max": 500 * 1024, "bg": "forbidden", "head": (32, 36)},
    "kr-id": {"size": (413, 531), "mm": (35, 45), "max": 250 * 1024, "bg": "optional", "head": (32, 36)},
    "kr-half": {"size": (354, 472), "mm": (30, 40), "max": 500 * 1024, "bg": "optional", "head": (25, 31)},
    "us-passport": {"size": (600, 600), "mm": (50.8, 50.8), "max": 240 * 1024, "bg": "forbidden", "head": (25.4, 34.9)},
}
SHEET = {"kr-passport": (1800, 1200), "kr-id": (1800, 1200), "kr-half": (1800, 1200), "us-passport": (1800, 1200)}
TIMEOUT = 120_000


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Checker:
    def __init__(self):
        self.count = 0
        self.failures = []

    def ok(self, condition, label):
        self.count += 1
        if not condition:
            self.failures.append(label)
            print(f"  ✗ {label}")
        return condition


def make_fixtures(labels):
    """PIL 로 파생 사진을 만든다. 이름이 gen_ 으로 시작하고 .gitignore 대상이다."""
    made = {}
    with Image.open(FIXTURES / "face2.jpg") as src:
        src = src.convert("RGB")
        factor = 3000 / src.height
        big = src.resize((round(src.width * factor), 3000), Image.LANCZOS)
        big.save(FIXTURES / "gen_big.jpg", quality=90)
        made["gen_big.jpg"] = {key: labels["face2.jpg"][key] * factor for key in ("crownY", "chinY", "eyeY", "centerX")}
        made["gen_big.jpg"].update(width=big.width, height=big.height)
        # 저장 픽셀은 반시계로 눕히고, Orientation=6(시계 90° 돌려 보라)을 붙인다 → 바로 세우면 원래 face2.
        stored = src.transpose(Image.ROTATE_90)
        exif = Image.Exif()
        exif[0x0112] = 6
        stored.save(FIXTURES / "gen_rotated.jpg", quality=92, exif=exif)
        made["gen_rotated.jpg"] = dict(labels["face2.jpg"])
    with Image.open(FIXTURES / "two_people.jpg") as src:
        part = src.convert("RGB").crop((300, 500, 950, 900))
        part.resize((part.width * 3, part.height * 3), Image.LANCZOS).save(FIXTURES / "gen_two_people_crop.jpg", quality=92)
    Image.new("RGB", (800, 1000), (180, 200, 220)).save(FIXTURES / "gen_plain.png")
    return made


def wait_result(page, name, spec=None, error=False):
    page.wait_for_function(
        """([name, spec, error]) => { const r = window.__idphoto; if (!r || r.fileName !== name) return false;
             if (error) return !!r.error; return !r.error && r.specId === spec; }""",
        arg=[name, spec, error], timeout=TIMEOUT)
    return page.evaluate("() => window.__idphoto")


def run_photo(page, name, spec):
    page.select_option("#spec", spec)
    page.set_input_files("#photo", str(FIXTURES / name))
    return wait_result(page, name, spec)


def save_download(page, button, target):
    with page.expect_download() as info:
        page.click(button)
    path = FIXTURES / target
    info.value.save_as(str(path))
    return path


def to_srgb(img):
    # 브라우저는 내장 색 프로파일(face3 은 Adobe RGB)을 sRGB 로 바꿔 그린다. PIL 은 안 바꾸므로 맞춰 준다.
    icc = img.info.get("icc_profile")
    if not icc:
        return img.convert("RGB")
    src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
    return ImageCms.profileToProfile(img, src, ImageCms.createProfile("sRGB"), outputMode="RGB")


def mean_patch(img, x, y, r=7):
    pixels = [img.getpixel((x + dx, y + dy)) for dx in range(-r, r + 1) for dy in range(-r, r + 1)]
    return [sum(p[i] for p in pixels) / len(pixels) for i in range(3)]


def out_y(value_upright, r):
    return (value_upright * r["k"] - r["crop"]["y"]) * r["outW"] / r["crop"]["w"]


def out_x(value_upright, r):
    return (value_upright * r["k"] - r["crop"]["x"]) * r["outW"] / r["crop"]["w"]


def check_photo(c, page, name, spec, label, source_path):
    r = run_photo(page, name, spec)
    tag = f"{name}/{spec}"
    s = SPECS[spec]
    c.ok("error" not in r, f"{tag} 처리 성공")
    if "error" in r:
        return r
    print(f"  {tag}: 머리 {r['headMm']:.1f}mm ok={r['ok']} 문제={r['problems']} q={r['quality']} {r['bytes']}B")
    # 크기·용량 — 실제 내려받은 파일로 확인
    path = save_download(page, "#single", f"gen_out_{spec}.jpg")
    with Image.open(path) as out:
        c.ok(out.size == s["size"], f"{tag} 픽셀 크기 {out.size}")
        out_rgb = out.convert("RGB")
    c.ok(path.stat().st_size <= s["max"], f"{tag} 용량 {path.stat().st_size} ≤ {s['max']}")
    c.ok(r["uprightW"] == label["width"] and r["uprightH"] == label["height"], f"{tag} 바로선 크기 {r['uprightW']}x{r['uprightH']}")
    # 검출 정확도 — 머리 높이의 6% 이내
    head_px = label["chinY"] - label["crownY"]
    for key in ("crownY", "chinY"):
        diff = abs(r["det"][key] / r["k"] - label[key])
        c.ok(diff <= head_px * 0.06, f"{tag} {key} 검출 오차 {diff:.0f}px ≤ {head_px * 0.06:.0f}")
    # 라벨로 독립 측정한 mm
    px_per_mm = s["size"][1] / s["mm"][1]
    head_mm = (out_y(label["chinY"], r) - out_y(label["crownY"], r)) / px_per_mm
    c.ok(abs(head_mm - r["headMm"]) <= 1.5, f"{tag} 라벨 측정 머리 {head_mm:.1f}mm vs 앱 {r['headMm']:.1f}mm")
    lo, hi = s["head"]
    c.ok(lo <= head_mm <= hi, f"{tag} 라벨 측정 머리 {head_mm:.1f}mm 가 규격 {lo}~{hi}mm 안")
    if spec == "us-passport":
        eye_mm = (s["size"][1] - out_y(label["eyeY"], r)) / px_per_mm
        c.ok(abs(eye_mm - r["eyeFromBottomMm"]) <= 1.5, f"{tag} 라벨 측정 눈높이 {eye_mm:.1f}mm vs 앱 {r['eyeFromBottomMm']:.1f}mm")
        c.ok(28.6 <= eye_mm <= 34.9, f"{tag} 라벨 측정 눈높이 {eye_mm:.1f}mm 가 규격 28.6~34.9mm 안")
    # 모서리 — 배경 금지 규격은 원본 그대로, 배경 켬은 흰색
    w, h = s["size"]
    corners = [(5, 5), (w - 6, 5), (5, h - 6), (w - 6, h - 6)]
    if s["bg"] == "forbidden":
        # 앱과 독립적으로 PIL 로 같은 영역을 잘라 같은 크기로 줄인 그림과 15×15 평균을 비교한다
        # (줄이는 과정에서 무늬가 평균 나므로 점 하나끼리 비교하면 안 된다).
        with Image.open(source_path) as src:
            up = to_srgb(ImageOps.exif_transpose(src))
        k, cr = r["k"], r["crop"]
        box = (cr["x"] / k, cr["y"] / k, (cr["x"] + cr["w"]) / k, (cr["y"] + cr["h"]) / k)
        # 크롭이 원본 밖으로 나가면(흰 띠) PIL 이 음수 좌표를 거부하므로 흰 여백을 붙여 놓고 자른다
        pad = int(max(0, -box[0], -box[1], box[2] - up.width, box[3] - up.height)) + 1
        canvas = Image.new("RGB", (up.width + 2 * pad, up.height + 2 * pad), "white")
        canvas.paste(up, (pad, pad))
        expected = canvas.resize((w, h), Image.BOX, box=tuple(v + pad for v in box))
        # 가장자리는 색 경계라 반 픽셀만 어긋나도 값이 튄다 — 12px 안쪽에서 본다
        for (x, y) in [(12, 12), (w - 13, 12), (12, h - 13), (w - 13, h - 13)]:
            ux, uy = box[0] + x / w * (box[2] - box[0]), box[1] + y / h * (box[3] - box[1])
            if not (0 <= ux < up.width and 0 <= uy < up.height):
                continue
            a, b = mean_patch(out_rgb, x, y), mean_patch(expected, x, y)
            delta = max(abs(a[i] - b[i]) for i in range(3))
            if not c.ok(delta <= 12, f"{tag} 모서리 ({x},{y}) 원본 유지 ΔRGB {delta:.0f}"):
                # E2E_DEBUG=<폴더> 를 주면 비교한 두 그림을 거기에 남긴다 (빈 값이면 아무것도 안 함)
                debug = os.environ.get("E2E_DEBUG")
                if debug and Path(debug).is_dir():
                    debug = Path(debug)
                    expected.save(debug / f"{name}_{spec}_expected.png")
                    out_rgb.save(debug / f"{name}_{spec}_app.png")
    elif r["bgReplaced"] and name == "face2.jpg":
        # 아래 두 모서리는 어깨(사람)라 위 두 모서리만 본다
        for (x, y) in corners[:2]:
            px = out_rgb.getpixel((x, y))
            c.ok(min(px) >= 245, f"{tag} 모서리 ({x},{y}) 흰 배경 {px}")
    # 모음판 크기
    sheet = save_download(page, "#sheet", f"gen_sheet_{spec}.jpg")
    with Image.open(sheet) as img:
        c.ok(img.size in (SHEET[spec], SHEET[spec][::-1]), f"{tag} 모음판 {img.size}")
    return r


def main():
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", 8765), lambda *a, **kw: QuietHandler(*a, directory=str(ROOT), **kw))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    c = Checker()
    labels = json.loads((FIXTURES / "labels.json").read_text(encoding="utf-8"))
    for name, label in labels.items():
        with Image.open(FIXTURES / name) as image:
            c.ok(image.size == (label["width"], label["height"]), f"{name} labels.json 크기 일치")
    derived = make_fixtures(labels)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 360, "height": 900}, accept_downloads=True)
            page = context.new_page()
            errors, bad_requests = [], []

            def on_request(req):
                url = req.url
                if url.startswith(("blob:", "data:")):
                    return
                # 기획 6장: 로컬 정적 파일·CDN 접두사·모델 2개만, 모두 GET·쿼리 없음·본문 없음
                allowed = (url.startswith((BASE, ALLOWED_CDN)) or url in (FACE_MODEL, SEGMENT_MODEL)) and "?" not in url
                if not allowed or req.method != "GET" or req.post_data:
                    bad_requests.append(f"{req.method} {url}")

            def watch(pg):
                # 모든 페이지에 같은 감시를 건다 (재시도용 page2 포함)
                pg.on("request", on_request)
                pg.on("websocket", lambda ws: bad_requests.append(f"WS {ws.url}"))
                pg.on("pageerror", lambda e: errors.append(str(e)))
                pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            watch(page)
            page.goto(BASE + "index.html")
            c.ok(page.evaluate("document.documentElement.scrollWidth") <= 360, "360px 가로 스크롤 없음(첫 화면)")

            print("[1] 정상 사진 3장 × 규격 4종")
            for name in ("face1.jpg", "face2.jpg", "face3.jpg"):
                for spec in SPECS:
                    check_photo(c, page, name, spec, labels[name], FIXTURES / name)
            c.ok(page.evaluate("document.documentElement.scrollWidth") <= 360, "360px 가로 스크롤 없음(결과 화면)")

            print("[1b] 큰 사진(3000px)·EXIF 회전 사진")
            for name, label in derived.items():
                r = check_photo(c, page, name, "kr-passport", label, FIXTURES / name)
                if name == "gen_big.jpg":
                    c.ok(abs(r["k"] - 2000 / 3000) < 1e-6, f"{name} 축소 배율 k={r['k']}")

            print("[2] 두 사람")
            page.set_input_files("#photo", str(FIXTURES / "gen_two_people_crop.jpg"))
            r = wait_result(page, "gen_two_people_crop.jpg", error=True)
            c.ok("한 사람만" in r["error"], f"두 사람 거부: {r['error']}")
            c.ok(page.is_disabled("#single"), "두 사람 — 내려받기 비활성")

            print("[3] 얼굴 없음")
            page.set_input_files("#photo", str(FIXTURES / "gen_plain.png"))
            r = wait_result(page, "gen_plain.png", error=True)
            c.ok("얼굴을 찾지 못했습니다" in r["error"], f"얼굴 없음: {r['error']}")

            print("[5] 처리 중 사진 바꾸기")
            page.select_option("#spec", "kr-passport")
            page.set_input_files("#photo", str(FIXTURES / "face1.jpg"))
            page.set_input_files("#photo", str(FIXTURES / "face2.jpg"))
            r = wait_result(page, "face2.jpg", "kr-passport")
            page.wait_for_timeout(3000)
            c.ok(page.evaluate("window.__idphoto.fileName") == "face2.jpg", "마지막 사진(face2)만 남음")

            print("[4] 모델 내려받기 실패 → 다시 시도")
            page2 = context.new_page()
            watch(page2)
            page2.route("https://storage.googleapis.com/**", lambda route: route.abort())
            page2.goto(BASE + "index.html")
            page2.select_option("#spec", "kr-half")
            page2.set_input_files("#photo", str(FIXTURES / "face1.jpg"))
            r = wait_result(page2, "face1.jpg", error=True)
            c.ok("인터넷" in r["error"], f"모델 실패 문구: {r['error']}")
            c.ok(page2.is_visible("#retry"), "다시 시도 버튼 보임")
            page2.unroute("https://storage.googleapis.com/**")
            page2.click("#retry")
            r = wait_result(page2, "face1.jpg", "kr-half")
            c.ok("error" not in r, "다시 시도 후 사진·규격 유지한 채 성공")

            # 모델 실패 페이지의 의도된 실패 로그는 제외
            # MediaPipe 는 "INFO: Created TensorFlow Lite XNNPACK delegate" 를 console.error 로 찍는다(정보성)
            real_errors = [e for e in errors if "storage.googleapis.com" not in e and "Failed to fetch" not in e
                           and "net::ERR_FAILED" not in e and not e.startswith("INFO:")]
            c.ok(not real_errors, f"콘솔 오류 없음 {real_errors[:3]}")
            c.ok(not bad_requests, f"허용 목록 밖 요청 없음 {bad_requests[:5]}")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        for path in FIXTURES.glob("gen_*"):
            path.unlink()
    if c.failures:
        print(f"E2E FAIL ({len(c.failures)}/{c.count} checks failed)")
        for item in c.failures:
            print(f"  - {item}")
        sys.exit(1)
    print(f"E2E OK ({c.count} checks)")


if __name__ == "__main__":
    main()
