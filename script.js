const themeToggle = document.querySelector("#themeToggle");
const themeIcon = themeToggle?.querySelector(".theme-icon");
const currentYear = document.querySelector("#currentYear");

const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};

function setTheme(theme) {
  const body = document.body;
  const isDark = theme === THEMES.DARK;
  body.classList.toggle("dark", isDark);
  if (themeIcon) {
    themeIcon.textContent = isDark ? "☀️" : "🌙";
  }
  localStorage.setItem("preferred-theme", theme);
}

function getPreferredTheme() {
  const storedTheme = localStorage.getItem("preferred-theme");
  if (storedTheme) return storedTheme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? THEMES.DARK : THEMES.LIGHT;
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("dark")
      ? THEMES.LIGHT
      : THEMES.DARK;
    setTheme(nextTheme);
  });
}

const init = () => {
  setTheme(getPreferredTheme());
  if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
  }
};

document.addEventListener("DOMContentLoaded", init);
