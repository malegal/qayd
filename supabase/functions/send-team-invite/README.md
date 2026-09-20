# send-team-invite

تنشئ هذه الدالة دعوة بريدية مرتبطة بمكتب واحد، وتعيد رابطًا لمرة واحدة. إذا تم ضبط `RESEND_API_KEY` و`INVITE_FROM_EMAIL` ترسل الرابط عبر Resend؛ وإلا تعيد الرابط للمالك لنسخه يدويًا.

## الإعداد

اضبط أسرار Edge Function التالية:

```text
QAYD_INVITE_BASE_URL=qayd://join
RESEND_API_KEY=re_...
INVITE_FROM_EMAIL=Qayd Office <no-reply@example.com>
```

`qayd://join` هو scheme تطبيق الهاتف الحالي. بعد تغيير `app.config.ts` يجب بناء APK جديد حتى يسجل Android هذا الرابط.

لا تضع `service_role` داخل تطبيق سطح المكتب أو الهاتف. الدالة تستخدم JWT المستخدم في Authorization، وRPC قاعدة البيانات تتحقق من أن المستخدم مالك المكتب.

## الطلب

```http
POST /functions/v1/send-team-invite
Authorization: Bearer <owner-access-token>
Content-Type: application/json
```

```json
{
  "office_id": "0c62b461-fe1f-49e3-98bf-1bb080bed80b",
  "email": "member@example.com",
  "role": "staff",
  "display_name": "اسم العضو",
  "expires_hours": 168
}
```

الأدوار المقبولة: `lawyer`, `staff`, `accountant`.

## النتيجة

```json
{
  "invite_id": "...",
  "invite_url": "qayd://join?token=...",
  "expires_at": "...",
  "role": "staff",
  "delivery": "email"
}
```

إذا لم تتوفر إعدادات البريد، تكون قيمة `delivery` مساوية لـ `manual`، ويعرض تطبيق سطح المكتب زر **نسخ الرابط**.

## قبول الدعوة في الهاتف

عند فتح `qayd://join?token=...` يقرأ تطبيق الهاتف قيمة `token` ويعرض شاشة الانضمام. يدخل العضو بريده وكلمة المرور واسمه. إذا كان الحساب جديدًا، تؤكد Supabase البريد أولًا؛ وبعد العودة للتطبيق يضغط العضو **قبول الدعوة والدخول** مرة أخرى. بعدها يستدعي التطبيق:

```text
accept_email_invite(p_token, p_display_name)
```

ويجب أن يطابق البريد في جلسة Supabase البريد الذي أنشأ المالك الدعوة له. الدور يؤخذ من الدعوة المخزنة، ولا يثق التطبيق بأي دور يرسله الهاتف.
