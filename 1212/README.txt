NEXORA • RP — ملتي بلاير + APK
================================
المحتويات:
  server/   سيرفر الملتي بلاير + لوحة الإدارة (على /admin)
  www/      اللعبة (تُغلَّف داخل APK)
  .github/  بناء ملف APK تلقائياً على GitHub

الخطوة 1: ارفع هذا المجلد كاملاً إلى مستودع GitHub جديد (بما فيه .github).

الخطوة 2: شغّل السيرفر على الإنترنت (مجاني تقريباً) — مثال Render.com:
  1. New + ثم Web Service، واربط مستودع GitHub.
  2. Root Directory:  server
  3. Build Command:   npm install
  4. Start Command:   npm start
  5. Environment: أضف OWNER_PASS = كلمة مرور قوية للمالك (والاسم zaid افتراضياً، تغيّره بـ OWNER_USER).
  6. بعد النشر ستحصل على عنوان مثل https://nexora-rp.onrender.com
     افتح العنوان + /admin لدخول لوحة الإدارة (zaid + كلمة المرور).
  ملاحظة: الخطة المجانية في Render تنام بعد فترة خمول ويأخذ إيقاظها نحو دقيقة، وقد تُمسح بيانات الحسابات عند إعادة النشر.
  للحفظ الدائم استخدم قرصاً دائماً (Persistent Disk) وضع DATA_FILE=/data/data.json، أو سيرفراً خاصاً VPS.

الخطوة 3: ابنِ الـAPK: تبويب Actions ثم Build APK ثم Run workflow، ثم نزّل NEXORA-RP-apk.

الخطوة 4: في اللعبة اختر "أونلاين (ملتي بلاير)"، واكتب عنوان السيرفر:  wss://nexora-rp.onrender.com
  ثم اسمك واختر COLMA أو MEDLEY. كل سيرفر 40 لاعباً كحد أقصى.

تجربة محلية للسيرفر:  cd server && npm install && npm start   ثم افتح http://localhost:8080/admin
