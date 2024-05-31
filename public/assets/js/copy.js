const preTags = document.querySelectorAll("pre");

preTags.forEach((preTag) => {
  const icon = document.createElement("i");
  icon.classList.add("fa-regular", "fa-clone");
  const text = document.createElement("span");
  text.textContent = "Copied!";

  const copyButton = document.createElement("button");
  copyButton.appendChild(icon);
  copyButton.appendChild(text);

  // Add click event listener to handle copying
  copyButton.addEventListener("click", () => {
    const codeText = preTag.getElementsByTagName("code")[0].innerText.trim();
    navigator.clipboard.writeText(codeText).then(
      () => {
        copyButton.classList.add("copied");
        setTimeout(() => {
          copyButton.classList.remove("copied");
        }, 1500);
      },
      () => {
        console.error("Failed to copy code to clipboard");
      }
    );
  });

  // Append the button as a child of the pre tag
  preTag.appendChild(copyButton);
});
