# حزمة الحافة — Docker (v0.5.3)

تشغيل «Radiology report AI» على خادم محلي داخل المستشفى بلا إنترنت.
خادم ملفات ثابتة فقط (nginx:alpine) — لا قاعدة بيانات، ولا معالجة على الخادم؛
كل التحليل يحدث في متصفح الجهاز العميل كما في النسخة العامة.

## التشغيل السريع (خادم فيه Docker)
```
cd repo-root
docker compose -f docker/docker-compose.yml up -d --build
```
ثم من أي جهاز على الشبكة المحلية: `http://SERVER_IP:8080`

## نقل بلا إنترنت (حالة الحصار)
1. على جهاز وسيط فيه Docker وإنترنت: `sh docker/build-bundle.sh` ثم اتبع التعليمات لبناء `rrai-web-image.tar.gz`.
2. انقل الملفين بـUSB إلى خادم المستشفى.
3. `gunzip -c rrai-web-image.tar.gz | docker load`
4. `docker run -d --name rrai-web -p 8080:80 --restart unless-stopped rrai-web`

## ملاحظات تقنية
- المتطلب الأدنى: ~40MB صورة، 128MB رام للحاوية (محددة في compose).
- على `http://` العادية يحجب المتصفح `crypto.subtle` — بصمات حزم الاستشارة
  تعمل عبر بديل SHA-256 مكتوب بالجافاسكربت (consult.v20.js)، فالاستشارات
  تعمل داخل LAN بلا شهادة TLS. التثبيت كـPWA والتخزين المؤقت دون اتصال
  يتطلبان HTTPS أو localhost (سلوك متصفح قياسي).
- `release.json` و`sw.js` بلا تخزين مؤقت (no-store)؛ الملفات الموسومة
  بإصدار (vNN) تُخزَّن دائمًا (immutable) — نفس سياسة النشر العامة.
- التحديث: انسخ `web/` الجديدة إلى الخادم ثم `docker compose up -d --build`،
  أو حمّل صورة جديدة. الإصدار يظهر في أسفل التطبيق (meta).
