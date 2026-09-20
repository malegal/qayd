# send-team-invite

تنشئ هذه الدالة دعوة بريدية مرتبطة بمكتب واحد، وتعيد رابطًا لمرة واحدة. إذا تم ضبط `RESEND_API_KEY` و`INVITE_FROM_EMAIL` ترسل الرابط عبر Resend؛ وإلا تعيد الرابط للمالك لنسخه وإرساله يدويًا عبر البريد أو واتساب.

## الأسرار والإعدادات

اضبط إعدادات الدالة التالية في بيئة Supabase Edge Functions:

```text
QAYD_APP_URL=https://qayd.app
RESEND_API_KEY=re_...
INVITE_FROM_EMAIL=قيد <no-reply@example.com>
```

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

الأدوار المقبولة: `lawyer`, `staff`, `accountant`. الدور يحدده المالك ولا يختاره العضو.

## النتيجة

عند نجاح إنشاء الدعوة تعيد الدالة:

```json
{
  "invite_id": "...",
  "invite_url": "https://qayd.app/join?token=...",
  "expires_at": "...",
  "role": "staff",
  "delivery": "email"
}
```

إذا لم تتوفر إعدادات البريد، تكون قيمة `delivery` مساوية لـ `manual`، ويعرض تطبيق سطح المكتب زر **نسخ رابط الدعوة**.

## قبول الدعوة

بعد تسجيل العضو وتأكيد بريده، يستدعي تطبيق الهاتف RPC:

```text
accept_email_invite(p_token, p_display_name)
```

ويجب أن يكون البريد في جلسة Supabase مساويًا للبريد الذي أنشأ المالك الدعوة له. تنشئ الدالة العضوية بالدور المخزن في الدعوة، ولا تثق بأي دور يرسله الهاتف.
