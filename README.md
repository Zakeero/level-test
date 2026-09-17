# Registon — Daraja o'tish test platformasi

O'quvchilar A1→A2, A2→B1, B1→B2 testlarini onlayn topshiradi. Admin savollarni qo'shadi va natijalarni ko'radi.

- **Hosting:** Vercel (bepul tarif yetadi)
- **Baza:** Neon Postgres (Vercel ichidan bepul ulanadi)

---

## Vercel'ga joylash (GitHub orqali)

### 1. GitHub'ga yuklash

1. GitHub'da yangi **private** repozitoriy oching, masalan `registan-test`.
2. Arxivdan chiqqan papkada terminalni oching:

```bash
git init
git add .
git commit -m "Registan test platformasi"
git branch -M main
git remote add origin https://github.com/FOYDALANUVCHI/registan-test.git
git push -u origin main
```

> `.env` va `node_modules` fayllari `.gitignore` tufayli GitHub'ga chiqmaydi.

### 2. Vercel'da loyiha ochish

1. [vercel.com/new](https://vercel.com/new) sahifasida repozitoriyni tanlang va **Import** bosing.
2. **Framework Preset:** `Other`. Boshqa sozlamalarga tegmang.
3. **Environment Variables** bo'limiga qo'shing:
   - `ADMIN_PASSWORD` — admin panel paroli (kuchli parol yozing)
   - `SECRET` — istalgan uzun tasodifiy satr, masalan 40 ta aralash belgi
4. **Deploy** bosing.

Birinchi deploy'dan keyin sayt ochiladi, lekin baza hali ulanmagani uchun "DATABASE_URL sozlanmagan" xabari chiqadi. Bu normal holat.

### 3. Bazani ulash (Neon)

1. Vercel'da loyihani oching → **Storage** → **Create Database** → **Neon** (Postgres).
2. Hudud (region) sifatida **Frankfurt** tanlang, O'zbekistonga eng yaqini shu. Bepul tarif yetarli.
3. Bazani shu loyihaga ulang (**Connect**). Vercel `DATABASE_URL`ni o'zi qo'shadi.
4. **Deployments** → oxirgi deploy → **⋯** → **Redeploy** bosing. O'zgaruvchilar faqat yangi deploy'da kuchga kiradi.

Tayyor. Sayt birinchi marta ochilganda jadvallar va 3 ta namuna test (har birida 15 ta savol) avtomatik yaratiladi.

- O'quvchilar uchun: `https://loyiha-nomi.vercel.app`
- Admin: `https://loyiha-nomi.vercel.app/admin`

### 4. O'z domeningizni ulash (ixtiyoriy)

Vercel → loyiha → **Settings → Domains** → masalan `test.registan.uz` qo'shing va ko'rsatilgan DNS yozuvini domen panelingizga kiriting.

### Keyingi o'zgarishlar

Kodni o'zgartirib `git push` qilsangiz, Vercel saytni o'zi yangilaydi. Bazadagi testlar va natijalar saqlanib qoladi.

---

## Lokal kompyuterda ishga tushirish (ixtiyoriy)

Node.js 20 yoki undan yangi versiya kerak.

```bash
npm install
cp .env.example .env    # ichiga Neon'dagi DATABASE_URL va parolni yozing
npm run dev
```

Keyin brauzerda `http://localhost:3000` va `http://localhost:3000/admin` manzillarini oching.

`DATABASE_URL`ni Vercel → Storage → bazangiz → **.env.local** bo'limidan nusxalab olasiz.

---

## Imkoniyatlar

**O'quvchi uchun**
- Ism, telefon, guruh va o'qituvchini kiritib, testni tanlaydi.
- Taymer ishlaydi. Vaqt tugasa test o'zi yakunlanadi, vaqt serverda ham tekshiriladi.
- Savollar va variantlar har bir o'quvchida aralashib chiqadi.
- Sahifa yangilansa ham javoblar yo'qolmaydi.
- Natijada foiz, o'tdi/o'tmadi, bo'limlar bo'yicha ball va xatolar tahlili ko'rsatiladi.

**Admin uchun**
- Testlarni yaratish va tahrirlash: vaqt, o'tish bali, testni yopib qo'yish.
- Savollarni bittalab yoki matndan ommaviy qo'shish.
- Natijalar: qidiruv, test, holat va sana bo'yicha filtr, statistika, har bir o'quvchining javoblari.
- Natijalarni Excel uchun CSV faylga yuklab olish.

To'g'ri javoblar brauzerga yuborilmaydi, baholash faqat serverda bo'ladi.

## Sozlamalar

| O'zgaruvchi | Vazifasi |
|---|---|
| `DATABASE_URL` | Neon bazasi manzili (Vercel o'zi qo'shadi) |
| `ADMIN_PASSWORD` | Admin panel paroli. Qo'yilmasa `admin123` bo'ladi, **albatta o'rnating** |
| `SECRET` | Admin sessiyasi kaliti. Qo'yilmasa paroldan hosil qilinadi |

Parolni o'zgartirsangiz, Redeploy qiling. Shundan keyin eski admin sessiyalari ham bekor bo'ladi.

## Savollarni ommaviy qo'shish formati

Admin → Testlar → Savollar → "Ommaviy qo'shish":

```
[Grammar]
1. She ___ to school every day.
a) go
*b) goes
c) going

[Reading]
2. Read: "Tom goes to work by bus." — How does Tom go to work?
a) by car
*b) by bus
```

- Savollar orasida bo'sh qator qoldiring.
- To'g'ri javob oldiga `*` qo'ying.
- `[Bo'lim nomi]` yozsangiz, keyingi savollar shu bo'limga tushadi.

## Fayllar

```
api/index.js         — Vercel serverless funksiyasi (API kirish nuqtasi)
lib/app.js           — barcha API va baza logikasi
lib/seed.js          — namuna testlar
public/index.html    — o'quvchi sahifasi
public/admin/        — admin panel
public/style.css     — dizayn (ranglar :root ichida)
dev.js               — lokal server
vercel.json          — Vercel sozlamalari
```

Ranglarni o'zgartirish uchun `public/style.css` boshidagi `--brand` (asosiy rang) va unga yaqin `--brand-*` qiymatlarini almashtiring.
