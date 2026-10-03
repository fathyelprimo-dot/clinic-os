# فحص وإصلاح المالك واستعادة كلمة المرور — 2026-10-03

التعديلات محلية فقط. لم تُطبّق migrations ولم تُنشر Functions أو Cloudflare، ولم تُحذف عيادة فعلية. لا توجد صورة مرفقة متاحة في الجلسة.

## الأدلة والأسباب

- سجل الوظيفة المنشورة أعاد HTTP 409 بتاريخ 2026-10-03، وسجل PostgreSQL أظهر `Clinic URL is already in use`: الرابط مستخدم بالفعل. رفض التكرار صحيح؛ الواجهة أصبحت تمنع الإرسال المتكرر وتستخدم معرّف عملية ثابتًا للمحاولة والتحقق من نتيجتها.
- مصدر `clinic-platform-admin` المنشور، version 8، ما زال يستخدم `inviteUserByEmail` ولا يقرأ `initial_password`. بعض رسائله العربية هي علامات استفهام ASCII فعلية. المصدر المحلي UTF-8 سليم، وترميز قاعدة البيانات UTF8؛ فحص حقول اسم/عنوان/تخصص العيادة لم يجد هذا التلف. الحل نشر المصدر الصحيح بعد المراجعة، وليس استبدال علامات الاستفهام في المتصفح.
- سجلات Auth تضمنت `email_exists` أثناء الدعوة. لا نغيّر كلمة مرور حساب موجود أو نتبنّاه اعتمادًا على البريد، لأنه قد يخص عيادة أو دورًا آخر.
- migration السابقة `20261002235035_patient_push_doctor_passwords.sql` موجودة محليًا لكنها غير مطبقة في المشروع المفحوص؛ جدول منع استخدام كلمة المرور الأولية غير موجود هناك. يجب تطبيقها قبل migration الجديدة.
- التعبيرات الموجودة في RPC تقبل بريدًا صحيحًا وأرقامًا عشرية عند اختبار المصدر الفعلي. نتيجة فحص أولية مخالفة كانت خطأ في تهريب استعلام التشخيص؛ لم يُعتمد ذلك كسبب للعطل.
- سجلات الاستعادة: `/recover` أعاد 200، وبعض `/verify` أعادت 303، وأخرى `One-time token not found`؛ كما ظهر `over_email_send_rate_limit`. الرابط المنتهي/المستخدم وقيود الإرسال أسباب مثبتة لبعض المحاولات. الوجهة الدقيقة لرابط المستخدم الذي أظهر Error لم تتوفر، ولذلك لا يمكن الجزم بإعداد لوحة Supabase الذي أنتجها.
- عيب التطبيق المُعاد إنتاجه: الصفحة الرئيسية تفتح `/owner.html` داخل iframe وتسقط معلومات callback. أضيف تحويل للاستعادة قبل استهلاكها، وصفحة مستقلة لا تعتمد على تفعيل العيادة أو الوصول إلى سجلاتها. تدعم hash جلسة recovery و`token_hash`، وتزيلهما من العنوان قبل طلب الشبكة. روابط `code` من تدفق PKCE قديم دون verifier صالح تعرض طلب رابط جديد؛ التطبيق الحالي لا ينشئ هذا التدفق.
- ظهر خطأ إضافي عند تشغيل Cloudflare محليًا: التاريخ `2026-10-02` أحدث من runtime المثبت الذي يدعم حتى `2026-05-22`. عُدّل `compatibility_date` إلى الحد المدعوم، دون نشر.

## الإنشاء والحذف

`owner_prepare_tenant` يتحقق من المالك وجميع البيانات قبل إنشاء Auth. سجل خادمي يحفظ UUID الحساب ومعرّف العملية فقط، دون كلمة مرور. `owner_complete_tenant` ينشئ العيادة والخدمات وطلب التفعيل وقيد تغيير كلمة المرور وتأكيد العملية في معاملة واحدة. عند فشل Auth/DB، يُراجع سجل العملية قبل حذف الحساب؛ عند نتيجة commit غير مؤكدة لا يُحذف حساب مرتبط. فشل التنظيف يظهر بوضوح ويمكن إعادة فحصه من لوحة المالك بعد انتهاء مهلة الدقيقتين، حتى بعد إعادة تحميل الصفحة. يُحتفظ بسجل العمليات للتشخيص؛ راقب `prepared`/`cleanup_required` عبر اللوحة ولا تتجاهل عمليات قديمة.

`owner_delete_clinic` محصور بـ service_role مع تحقق مالك داخل SQL. تأكيد الاسم/slug مطلوب خادميًا أيضًا. جميع سجلات العيادة تُحذف في معاملة واحدة؛ وجود اعتماد غير معروف يفشل العملية ويرجع كل التغييرات. حسابات Auth المستقلة لا تُحذف لأنها قد تكون مشتركة. مسارات صور clinic-media تحفظ في إيصال تنظيف خاص ثم تُحذف عبر Storage API؛ عند فشل Storage تقول الواجهة إن بيانات العيادة حُذفت لكن الصور قيد التنظيف، وتتيح إعادة المحاولة. لا يُدّعى اكتمال تنظيف الصور قبل نجاحه.

## إعداد خارجي مطلوب بعد المراجعة

1. خذ نسخة احتياطية واستخدم مشروع اختبار منفصل. طبّق migrations السابقة المفقودة بالترتيب، ثم `20261002235035_patient_push_doctor_passwords.sql` وبعدها `20261003004126_owner_provision_delete_recovery.sql`. سجل المشروع يحتوي migrations مالك تاريخية غير موجودة بالكامل في هذا checkout؛ لا تنفّذ reset على الإنتاج ولا تعالج اختلاف التاريخ بإعادة تطبيق migrations قديمة عشوائيًا. fixtures الاختبار ليست migrations إنتاج.
2. انشر النسخة المحلية كاملة من `clinic-platform-admin` مع `operations.ts` إلى الاختبار. إعداد `verify_jwt=false` مقصود للسماح بالمفتاح publishable؛ الوظيفة تتحقق من Bearer JWT عبر `getUser` ثم `platform_admins`، وSQL يتحقق من المالك مجددًا. لا تنشر وظيفة قديمة بعد migration الجديدة.
3. أسرار Functions المطلوبة: `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، و`SUPABASE_PUBLISHABLE_KEY` أو خريطة `SUPABASE_PUBLISHABLE_KEYS` ذات `default`. كلها خادمية؛ القيمة الوحيدة في config الواجهة هي URL ومفتاح publishable. لم تُخترع أو تُكتب أسرار جديدة.
4. Supabase → Authentication → URL Configuration: اجعل **Site URL** أصل التطبيق HTTPS الفعلي. في **Redirect URLs** اسمح بمسار `https://<النطاق-الفعلي>/clinic/reset-password.html` مع query العيادة (يمكن نمط `.../clinic/reset-password.html**` المحدود بهذا المسار)، وأبقِ `/owner.html?owner=1` وروابط الأطباء القديمة المصرح بها. أضف نطاق الاختبار وlocalhost بشكل منفصل؛ لا تستخدم wildcard شاملًا للإنتاج. الإعداد المحلي في config.toml يخص CLI فقط ولا يعدّل Dashboard.
5. Authentication → Email Templates → **Reset Password**: القالب في `supabase/templates/recovery.html` يستخدم `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=recovery`، فتظل قيمة token_hash في fragment ولا تصل إلى سجل طلب صفحة Cloudflare. يمكن استعمال القالب الافتراضي `{{ .ConfirmationURL }}` كذلك، لأنه يتحقق لدى Supabase ثم يعيد جلسة recovery في fragment. لا تستخدم `{{ .SiteURL }}` وحده وتتجاهل مسار العودة، ولا ترسل كلمة المرور بالبريد. روابط قديمة انتهت/استُهلكت تحتاج رسالة جديدة.
6. Authentication → SMTP Settings / Rate Limits: تحقق من مزود SMTP والمرسل واعتماد النطاق، وحد الإرسال وEmail OTP Expiration. لا تزيد الحدود لإخفاء العطل؛ حالة 429 تتطلب الانتظار أو إصلاح إعداد البريد. لم تتوفر قراءة موثوقة لقيم SMTP أو Site URL أو قالب البريد الحالي من الأدوات، فلم يُدّعَ ضبطها.
7. Cloudflare: استخدم build الحالي وassets `dist/client` وHTTPS. أضيف `assets.html_handling="none"` لأن التشغيل المحلي أثبت تحويل `.html` تلقائيًا إلى مسارات أخرى؛ الروابط الحالية أصبحت مستقرة. يجب أن تصل `/clinic/reset-password.html` وملفات JS إلى الأصول بدل إعادة كتابتها إلى صفحة Error أو لوحة المالك؛ حافظ على fragment/query في التحويلات. راجع أي Redirect Rules أو Pages `_redirects` خارج هذا المستودع. اختبر نطاقًا تجريبيًا قبل الإنتاج. لا يلزم Service Role أو مفتاح VAPID في إعداد متصفح Cloudflare.

إعدادات Push السابقة محفوظة في [PATIENT-PUSH-AUTH-SETUP.md](./PATIENT-PUSH-AUTH-SETUP.md)؛ لم يُستبدل نظام الإشعارات في هذا الإصلاح.

## التحقق

أوامر محلية: `npm run test:phase2`، `npm run test:patient-db`، `npm run test:patient-services`، `npm run test:owner-db`، `npm run test:patient-browser`، `npm run test:owner-browser`، `npm run check:encoding`، `npm run lint`، `npm run build`؛ وDeno check للوظائف. اختبارات PostgreSQL تعمل في PGlite مع بيانات صناعية فقط، واختبارات المتصفح تعترض جميع طلبات Supabase. لا تختبر إرسال البريد الحقيقي أو Auth gateway الفعلي، ولا تضمن توافق migrations التاريخية المفقودة مع بيئة أخرى؛ يلزم smoke على مشروع اختبار وSMTP حقيقي بعد الإعداد.

مرجع الإعداد الرسمي: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)، [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)، [Auth admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## الملفات ونتائج الفحص النهائي

| الملفات | التغيير |
| --- | --- |
| `app/page.tsx` | توجيه callbacks الاستعادة الواصلة للجذر إلى الصفحة المناسبة |
| `dist/owner.html`, `dist/owner.css`, `dist/owner.js` | حذف بتأكيد مكتوب، منع تكرار الإنشاء، إزالة طلب التحديث الثاني، عرض العمليات/تنظيف الصور غير المكتملة |
| `dist/index.html`, `dist/stage2.js`, `dist/supabase-client.js` | تحويل الرابط القديم، URL استعادة مستقل، رسالة النجاح عند العودة للدخول |
| `dist/auth-entry.js`, `dist/recovery.js`, `dist/reset-password.html` | استقبال الاستعادة والتحقق من الجلسة/الرابط ونموذج كلمة المرور ورسائل الانتهاء |
| `supabase/functions/clinic-platform-admin/index.ts`, `operations.ts` | المصادقة والتحقق والتنسيق بين Auth/SQL/Storage والتعويض والتشخيص دون بيانات حساسة |
| `supabase/migrations/20261003004126_owner_provision_delete_recovery.sql` | معاملات الإنشاء والحذف وسجلات العمليات والتنظيف وسياسات وصول خاصة بالخادم |
| `supabase/config.toml`, `supabase/templates/recovery.html` | إعداد وقالب استعادة محليان؛ لا يعدّلان إعدادات المشروع المنشور |
| `wrangler.jsonc` | تاريخ توافق مدعوم ومسارات HTML ثابتة |
| `scripts/sync-ui.mjs`, `package.json` | نشر أصول الاستعادة إلى النسخة المحلية وإضافة أوامر الفحص |
| `scripts/check-encoding.mjs`, `test-owner-db.mjs`, `test-owner-browser.mjs`, `fixtures/deployed-owner-rpcs.sql` | اختبارات UTF-8 وPostgreSQL والمتصفح ومصدر RPC الحقيقي كـfixture فقط |
| `scripts/test-phase2.mjs`, `test-patient-services.mjs`, `test-patient-browser.mjs` | تكييف الاختبارات مع فصل عمليات الخادم وصفحة الاستعادة واختبار التعويض الملتبس |
| `public/owner.*`, `public/auth-entry.js`, `public/clinic/{index.html,stage2.js,supabase-client.js,auth-entry.js,recovery.js,reset-password.html}` | نسخ متزامنة من أصول `dist`؛ لا بيانات وهمية داخل المنتج |
| `docs/OWNER-REPAIR-SETUP.md` | الأدلة والحدود والإعداد والتقرير |

النتائج: 57 فحص domain/transport، و27 فحص PostgreSQL للحجز/Push/قيد كلمة المرور، و21 فحص خدمات وتعويض، و38 فحص PostgreSQL للمالك، و7 مسارات متصفح سابقة، و18 فحص متصفح جديد على خادم الملفات، و19 على Cloudflare المحلي تشمل callback الجذر والحفاظ على رابط دخول المالك. نجح browser smoke السابق لسطح المكتب والهاتف، و12 فحص UTF-8، وESLint، وDeno check للوظائف الثلاث، وbuild النهائي. إخفاق تشغيل Cloudflare الأول وتوقعات اختبارات الصفحة القديمة صُححت وأُعيد تشغيلها بنجاح. يوجد تنبيه vinext غير مانع بأن تصنيف المسار ديناميكيًا غير معروف؛ البناء خرج بالرمز 0.

لم يُختبر إرسال بريد حقيقي أو إنشاء حساب على Supabase فعلي أو تطبيق migrations على الإنتاج. النجاح المذكور محلي ومعزول، وليس ادعاءً باكتمال إعداد SMTP/Redirect URLs أو صلاحية رابط المستخدم القديم.
