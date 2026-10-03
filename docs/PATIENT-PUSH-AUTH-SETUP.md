# إعداد الحجز المباشر وWeb Push وحسابات الأطباء

التعديلات محلية فقط. لم تُطبّق Migration ولم تُنشر Functions أو واجهة، ولم تُضبط أسرار أو بريد على مشروع الإنتاج.

## الملفات والسلوك

- المصدر المشترك للواجهة هو `dist/stage2.js` و`dist/supabase-client.js` و`dist/owner.html` و`dist/owner.js`. ينقل `scripts/sync-ui.mjs` هذه الملفات إلى `public/clinic/` و`public/`. لا تعدّل النسخ المنقولة وحدها.
- الحجز الجديد يستخدم `patient-booking` دون Supabase phone OTP ودون إرسال SMS. رقم الهاتف بيانات تواصل، وليس إثبات ملكية لملفات سابقة. لا يوجد بحث عام يكشف المرضى باستخدام الرقم.
- كل حجز جديد ينشئ ملفًا منفصلًا لا يُربط بملف سابق بمجرد تطابق الهاتف. متابعة الحجز الجديد تحتاج صلاحية عشوائية 256-bit؛ تُخزن بصمتها فقط في Supabase. الرابط الخاص يحتويها في fragment، ويزيلها التطبيق من شريط العنوان بعد قراءتها. احتفظ بالرابط ولا تشاركه. لا تُحفظ صلاحية الحجز أو بياناته في localStorage. إذا فقد المريض الرابط، يتواصل مع الاستقبال. التحقق القديم لعرض الحجوزات المرتبطة بهوية هاتف مؤكدة يبقى منفصلًا؛ لا يضم حجوزات الضيف تلقائيًا.
- يتطلب الاشتراك موافقة المريض في الحجز وضغط زر تفعيل بعد تأكيده. تعرض الواجهة سبب التنبيهات وحدود وصولها. لا تطلب إذنًا عند تحميل الصفحة.
- `push-sw.js` يعرض الإشعارات بعد إغلاق الصفحة. الرسائل تحتوي تأكيدًا أو تحديث دور/وقت تقديري، دون اسم/هاتف/تشخيص/رمز متابعة. رابط الإشعار يفتح العيادة؛ التفاصيل تحتاج رابط المتابعة الخاص.
- الإشعارات تستخدم جداول `notifications` و`notification_deliveries` وطابور المحاولات والـleases الحالي. لا توجد خدمة إرسال مكررة. تأكيد الحجز يضاف بعد تسجيل الاشتراك؛ تحديثات ETA تُجمّع كل 5 دقائق من التقدير، بحد تحديث واحد كل 10 دقائق عند تغيره. تنبيهات «حان دورك» و«وقت التحرك» الموجودة تبقى. لا تتحول حجوزات الضيف إلى SMS عند غياب الاشتراك. مسار مزود الرسائل القديم يبقى فقط للحجوزات القديمة المؤكدة.
- الاشتراكات مرتبطة بالحجز والعيادة بمفتاح أجنبي مركب. جداول الاشتراكات والصلاحيات والحدود وكلمات المرور تفعّل RLS وتمنع جميع صلاحيات المتصفح؛ الوصول حصري للـService Role داخل الوظائف المحمية. تُحذف الاشتراكات عند 404/410 أو انتهاء 31 يومًا. الأخطاء المؤقتة تستعمل إعادة المحاولة الحالية.
- المالك ينشئ الدكتور بكلمة مرور أولية عبر `clinic-platform-admin` بعد التحقق الفعلي من جلسة المالك وجدول `platform_admins`. لا يستبدل بريدًا موجودًا أو حسابًا في عيادة أخرى. لا تُرسل دعوة بريد للدكتور الجديد؛ يجب أن يبلّغه المالك بيانات الدخول عبر وسيلة خاصة. تبقى موافقة المالك على تفعيل العيادة كما كانت.
- `doctor_password_requirements` يحجب صلاحيات الفريق وقراءات snapshot/history والتخزين حتى يتغير password hash في Supabase Auth. لا تعتمد صلاحيات المنع على user_metadata أو ادعاء من المتصفح. لا توجد كلمة مرور نصية في الجداول أو السجلات أو التخزين المحلي. تُمسح حقول كلمة المرور بعد محاولة الإنشاء/الدخول/التغيير.
- «نسيت كلمة المرور؟» يستخدم Supabase Auth Recovery، ويعرض رسالة موحدة سواء كان البريد موجودًا أو غير موجود. رابط الاستعادة يفتح شاشة تغيير كلمة المرور داخل التطبيق. يمكن تغييرها لاحقًا من أدوات الدكتور.

## متطلبات قبل تشغيل بيئة اختبار

1. راجع سجل Migration المفقود الموضح في `README.md`: هذه النسخة المحلية ليست سجلًا كاملًا لإنشاء مشروع Supabase جديد. الـMigration الجديدة تعتمد على `platform_admins` و`clinic_subscriptions` و`private.is_platform_admin_user` وسائر وظائف المالك الموجودة في المشروع. يجب استكمال السجل ومقارنة ترتيب الإصدارات في بيئة اختبار أولًا. لا تنفذ `db push` على الإنتاج من هذا السجل الناقص.
2. استخدم بيئة Supabase اختبار معزولة، ثم طبّق `20261002235035_patient_push_doctor_passwords.sql` هناك بعد مطابقة المتطلبات. يتطلب الـtrigger الجديد إذن إنشاء trigger على `auth.users`؛ تحقق من عمله مع Supabase Auth الحقيقي (التغيير الطبيعي والاستعادة ورفض إعادة استخدام الكلمة نفسها).
3. انشر الوظائف إلى بيئة الاختبار فقط. `supabase/config.toml` يحدد `verify_jwt=false` لهذه الوظائف: المريض لا يملك جلسة Auth، والإرسال يقبل `DISPATCH_SECRET` حصريًا، ووظيفة المالك تتحقق من JWT عبر `getUser` وجدول المالك بنفسها. لا تزل أيًا من هذه الفحوص الداخلية. لا يمنح مفتاح publishable أي وصول للجداول الخاصة.
4. فعّل جدولة خادم/cron تستدعي `notification-dispatch` كل دقيقة عبر HTTPS و`Authorization: Bearer <DISPATCH_SECRET>` من مخزن أسرار آمن. لا تضع السر في الواجهة أو في SQL/ملفات Git. لا يوجد إرسال خلفي بمجرد إضافة Service Worker دون تشغيل الجدولة.
5. اضبط الأسرار التالية في Functions؛ القيم غير موجودة في هذه التعديلات:

| الإعداد | الغرض |
| --- | --- |
| `PATIENT_APP_ORIGINS` | أصول الواجهة المسموح بها مفصولة بفاصلة، بدون wildcard، مع HTTPS للبيئة الحقيقية |
| `PATIENT_RATE_LIMIT_SECRET` | سر عشوائي قوي لإنشاء HMAC لحدود الهاتف/IP دون حفظهما في جدول الحدود |
| `VAPID_PUBLIC_KEY` | مفتاح VAPID العام، يرجع للمتصفح عبر وظيفة config فقط |
| `VAPID_PRIVATE_KEY` | المفتاح الخاص؛ للخادم وحده |
| `VAPID_SUBJECT` | عنوان تواصل VAPID صالح، مثل mailto خاص بالمشغل |
| `DISPATCH_SECRET` | حماية استدعاء طابور الإرسال من المجدول |
| `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` | متغيرات خادم Supabase، لا تُنقل للواجهة |
| `SUPABASE_PUBLISHABLE_KEY` أو `SUPABASE_PUBLISHABLE_KEYS` | التحقق من جلسة المالك داخل الوظيفة الحالية |
| `NOTIFICATION_WEBHOOK_URL` و`NOTIFICATION_WEBHOOK_TOKEN` | مطلوبان فقط إذا أبقيت إرسال الرسائل للحجوزات القديمة |

6. أنشئ زوج VAPID حقيقيًا خارج Git، واحفظه في الأسرار. عند تدوير المفتاح يعيد المتصفح الاشتراك بعد تفاعل المريض. مفاتيح الاشتراك الجديدة لا تُستنتج أو تُكتب كقيم وهمية في إعدادات المشروع.
7. افحص أن ingress موثوق يكتب `x-forwarded-for` ويزيل القيمة المرسلة من العميل. حدود الطلبات محفوظة في PostgreSQL: 100 طلب/IP/ساعة، 5 محاولات حجز/هاتف/عيادة/ساعة، 10 محاولات اشتراك/صلاحية/ساعة. فشل الحجز لا يلغي تسجيل المحاولة. أضف قيودًا عند ingress إذا كانت شبكة العيادة الكبيرة تشارك IP واحدًا أو احتجت مقاومة إساءة موزعة؛ الرقم وحده لا يكشف البيانات أصلًا.
8. اضبط Supabase **Authentication → URL Configuration → Site URL / Redirect URLs** على الأصل الحقيقي وصفحة `/clinic/index.html` مع query `clinic` و`portal=doctor` و`reset=1`. لا تسمح بتحويلات إلى نطاقات غير موثوقة. نموذج رابط يصف المسار فقط: `https://<أصل-التطبيق>/clinic/index.html?clinic=<slug>&portal=doctor&reset=1`؛ ليس قيمة تم إعدادها.
9. افحص **Authentication → Email / SMTP**: مزود SMTP المخصص وصلاحية المرسل وحدود الإرسال وقالب Recovery الذي يرسل رابطًا آمنًا. تظل سياسات طول/قوة كلمة المرور في Supabase Auth هي المرجع بجانب حد الواجهة 12–128 حرفًا. فعّل حماية تغيير البريد وكلمة المرور وإبطال الجلسات بحسب سياسة التشغيل. لا تُرسل كلمات المرور عبر البريد.
10. HTTPS ضروري لـService Worker وPush؛ localhost استثناء تطوير. تحقق من توافق المتصفح والجهاز، خصوصًا إضافة الموقع للشاشة الرئيسية على أجهزة iOS. الشبكة وإعدادات المتصفح والنظام قد تؤخر الإشعار أو تمنعه؛ قبوله من مزود Push لا يثبت وصوله للجهاز.

لا يمكن التحقق من SMTP وRedirect URLs والأسرار وجدولة الخادم وتوافق الجهاز من الملفات وحدها. لم تُقرأ إعداداتها الحية في هذه المهمة، ولم يُدّع أنها جاهزة.

مراجع التنفيذ: [Supabase Password Auth](https://supabase.com/docs/guides/auth/passwords)، [إنشاء مستخدم Auth من الخادم](https://supabase.com/docs/reference/javascript/auth-admin-createuser)، [Web Push وService Worker](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

## الاختبارات المحلية

الملفات المعدلة/المضافة: `dist/stage2.js`، `dist/supabase-client.js`، `dist/push-sw.js`، `dist/owner.html`، `dist/owner.js` ونسخها في `public/clinic/` و`public/`. أُعيدت مزامنة `public/owner.css` مع المصدر الموجود. ملفات الخادم: `supabase/functions/patient-booking/index.ts`، `supabase/functions/_shared/push.ts`، `supabase/functions/notification-dispatch/index.ts`، `supabase/functions/clinic-platform-admin/index.ts`، `supabase/functions/deno.json`، `supabase/functions/deno.lock`، `supabase/config.toml`، والـMigration الجديدة. الاختبارات: `scripts/test-patient-db.mjs`، `scripts/test-patient-services.mjs`، `scripts/test-patient-browser.mjs`، `scripts/test-static-server.mjs`، `scripts/browser-smoke.mjs`، `scripts/test-phase2.mjs`. البناء والتوثيق: `scripts/sync-ui.mjs`، `vite.config.ts`، `eslint.config.mjs`، `package.json`، `package-lock.json`، `.gitignore`، `README.md` وهذا الدليل.

- `npm run test:phase2`: فحوص المشروع الحالية.
- `npm run test:patient-db`: PostgreSQL مضمّن ومعزول عبر PGlite؛ يختبر الـMigration والحجز والـRLS وحدود الطلبات ومنع الدكتور وطابور Push. يستخدم fixture محدودًا للجزء الناقص من مخطط المالك؛ لا يغني عن اختبار Supabase Auth/البوابة الحقيقيين.
- `npm run test:patient-services`: وظائف الخادم والنقل بمهيئات اختبار فقط؛ لا يتصل بالإنتاج.
- `node scripts/browser-smoke.mjs <مجلد-الصور>` و`node scripts/test-patient-browser.mjs`: اختبارات Edge مخفي تتطلب Playwright وMicrosoft Edge. يمكن ضبط `CODEX_PRIMARY_RUNTIME_NODE_MODULES` على مجلد اعتماديات اختبار خارجي. اختبار المسارات الجديدة يعترض جميع الطلبات الخارجية؛ لا يكتب بيانات الاختبار إلى Supabase.
- `npm run lint` و`npm run build`، و`deno check --config supabase/functions/deno.json` للوظائف المعدلة. يحتفظ build الآن بملفات المصدر المشتركة في `dist`.

يلزم قبل أي نشر لاحق اختبار end-to-end حقيقي في بيئة اختبار: حجز، اشتراك جهاز حقيقي، إغلاق الصفحة، وصول تأكيد وتحديث الدور، اشتراك منتهٍ، تغيير كلمة المرور الأولى، وصول بريد Recovery، وإكمال الرابط. لم تنفّذ هذه المهمة إرسالًا حقيقيًا أو نشرًا.
