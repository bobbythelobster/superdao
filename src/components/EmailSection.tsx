import { createSignal } from "solid-js";
import "./EmailSection.css";

export default function EmailSection() {
  const [email, setEmail] = createSignal("");
  const [submitted, setSubmitted] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (email()) {
      const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSewU30SE7DVtakyaVJFbCshiyPRL7dA4xe6kq5fEuSCxlI65A/formResponse';
      const formData = new FormData();
      formData.append('entry.1226568355', email());
      
      try {
        await fetch(formUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: formData
        });
        setSubmitted(true);
      } catch (error) {
        console.error('Submission error:', error);
      }
    }
  };

  return (
    <section class="email-section">
      <div class="email-content">
        <h2 class="email-title">Get Early Access</h2>
        <p class="email-subtitle">Join the waitlist</p>
        
        {!submitted() ? (
          <form class="email-form" onSubmit={handleSubmit}>
            <input
              type="email"
              class="email-input"
              placeholder="Enter your email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
            />
            <button type="submit" class="email-button">
              Join Waitlist
            </button>
          </form>
        ) : (
          <div class="success-message">
            <p>Welcome aboard. We'll notify you when it's your turn.</p>
          </div>
        )}
      </div>
    </section>
  );
}
