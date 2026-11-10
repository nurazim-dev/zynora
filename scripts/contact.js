const contactForm = document.querySelector("#contact-form");
const formStatus = document.querySelector("#form-status");

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;

  const submitButton = contactForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  formStatus.textContent = "Отправляем сообщение…";
  formStatus.dataset.state = "";

  const data = Object.fromEntries(new FormData(contactForm).entries());

  try {
    const response = await fetch(contactForm.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось отправить сообщение.");

    contactForm.reset();
    formStatus.textContent = "Спасибо! Ваше сообщение отправлено.";
    formStatus.dataset.state = "success";
  } catch (error) {
    formStatus.textContent = error.message || "Ошибка соединения. Попробуйте ещё раз.";
    formStatus.dataset.state = "error";
  } finally {
    submitButton.disabled = false;
  }
});
