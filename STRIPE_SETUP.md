# Turning on payments (every 2 weeks)

Your site is already wired for **Stripe**. You just need a free Stripe account and
3 "Payment Links." No coding — copy and paste. Takes about 10 minutes.

## What you'll end up with
- Starter — $300 charged automatically every 2 weeks
- Growth — $500 charged automatically every 2 weeks
- Premium — $800 charged automatically every 2 weeks

The first charge happens at signup, then it repeats every 2 weeks until the client cancels.

---

## Step 1 — Create a Stripe account
Go to https://dashboard.stripe.com/register and sign up (it's free; Stripe takes a small
fee per payment). Finish the short business setup so you can accept live payments.

## Step 2 — Create a product + price for each package
In the Stripe Dashboard:
1. Go to **Product catalog → + Add product**.
2. Name it (e.g. **Starter**).
3. Under **Pricing**:
   - **Recurring**
   - Amount: **$300.00**
   - Billing period: choose **Custom**, then set it to every **2 weeks**
     (interval = *weekly*, count = *2*).
4. Click **Save product**.
5. Repeat for **Growth ($500)** and **Premium ($800)**.

## Step 3 — Make a Payment Link for each product
1. Go to **Payment Links → + New**.
2. Select the product (e.g. Starter) and its recurring price.
3. Click **Create link** and **Copy** the URL — it looks like
   `https://buy.stripe.com/abc123`.
4. Repeat for Growth and Premium.

## Step 4 — Paste the links into the site
Open **`script.js`** (top of the file) and fill in the three URLs:

```js
const STRIPE_LINKS = {
  Starter: "https://buy.stripe.com/your-starter-link",
  Growth:  "https://buy.stripe.com/your-growth-link",
  Premium: "https://buy.stripe.com/your-premium-link",
};
```

Save, commit, and push — or just send me the three links and I'll drop them in for you.

That's it. Once the links are in, the **Choose [Package]** buttons take clients straight
to Stripe's secure checkout, and the recurring 2-week billing is handled by Stripe
automatically. Until then, those buttons send people to your signup form instead.

---

### Notes
- Stripe handles all the card data and security — nothing sensitive ever touches this site.
- You can add a free trial, taxes, or coupons later from the same Payment Link settings.
- To pause/cancel a client, you do it from the Stripe Dashboard.
