// Fade sections in as they scroll into view.
const targets = document.querySelectorAll('.block, .reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.06 });
targets.forEach((target) => observer.observe(target));
