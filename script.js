// =============================================================
//  CONFIG — the two things you can turn on yourself
// =============================================================

// 1) PAYMENTS (Stripe Payment Links).
//    When you create your Stripe account, make a Payment Link for each
//    package (recurring every 2 weeks) and paste the URLs below.
//    See STRIPE_SETUP.md for step-by-step instructions.
//    Until a link is filled in, the button sends people to the signup form.
const STRIPE_LINKS = {
  Starter: "", // e.g. "https://buy.stripe.com/xxxxxxxx"
  Growth: "",  // e.g. "https://buy.stripe.com/yyyyyyyy"
  Premium: "", // e.g. "https://buy.stripe.com/zzzzzzzz"
};

// 2) EMAIL — where signup form submissions are sent.
//    Uses Formsubmit (free, no account). The FIRST time someone submits,
//    Formsubmit emails this address a one-time link to activate. Click it once.
const SIGNUP_EMAIL = "jaden.thomas.media@gmail.com";

// =============================================================

// ===== Year in footer =====
document.getElementById("year").textContent = new Date().getFullYear();

// ===== Sticky nav background on scroll =====
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// ===== Mobile menu toggle =====
const toggle = document.getElementById("navToggle");
const links = document.getElementById("navLinks");
toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.classList.toggle("open", open);
});
links.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    links.classList.remove("open");
    toggle.classList.remove("open");
  })
);

// ===== Reveal on scroll =====
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("in"));
}

// ===== Animated stat counters =====
const counters = document.querySelectorAll("[data-count]");
const animateCount = (el) => {
  const target = parseFloat(el.dataset.count);
  const suffix = el.dataset.suffix || "";
  const isFloat = target % 1 !== 0;
  const duration = 1500;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = target * eased;
    el.textContent = (isFloat ? val.toFixed(1) : Math.round(val)) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
if ("IntersectionObserver" in window) {
  const statIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          statIO.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  counters.forEach((c) => statIO.observe(c));
}

// ===== Package buttons → Stripe checkout (or signup form) =====
const packageSelect = document.getElementById("package");
document.querySelectorAll(".plan__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const plan = btn.dataset.plan;
    const link = STRIPE_LINKS[plan];
    if (link) {
      // Payment is configured — send them straight to checkout.
      window.location.href = link;
      return;
    }
    // No payment link yet — pre-select the plan and scroll to the signup form.
    if (packageSelect) {
      const match = [...packageSelect.options].find((o) => o.value === plan);
      if (match) packageSelect.value = plan;
    }
    document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  });
});

// ===== Signup / contact form → email via Formsubmit =====
const form = document.getElementById("contactForm");
const note = document.getElementById("formNote");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  note.className = "contact__note";
  note.textContent = "";

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const message = form.message.value.trim();
  const pkg = form.package.value;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Honeypot — if filled, silently drop (it's a bot).
  if (form._honey && form._honey.value) return;

  if (!name || !emailOk || !message) {
    note.classList.add("error");
    note.textContent = "Please fill in your name, a valid email, and a message.";
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  // Local backup so a lead is never lost even if the network fails.
  try {
    const saved = JSON.parse(localStorage.getItem("im_leads") || "[]");
    saved.push({ name, email, package: pkg, message, at: new Date().toISOString() });
    localStorage.setItem("im_leads", JSON.stringify(saved));
  } catch (_) {}

  try {
    const res = await fetch(`https://formsubmit.co/ajax/${SIGNUP_EMAIL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name,
        email,
        package: pkg || "Not specified",
        message,
        _subject: `New Influence Media signup${pkg ? " — " + pkg : ""}`,
        _template: "table",
      }),
    });
    if (!res.ok) throw new Error("Network error");
    note.classList.add("success");
    note.textContent = `Thanks ${name}! Your message is on its way — we'll reply within one business day.`;
    form.reset();
  } catch (err) {
    note.classList.add("error");
    note.textContent = "Hmm, something went wrong sending that. Please DM us on Instagram @influencemedia.ai and we'll get right back to you.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});
