const readline = require("node:readline/promises");
const bcrypt = require("bcryptjs");

async function main() {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await terminal.question("Пароль администратора (не менее 12 символов): ");
  terminal.close();
  if (password.length < 12) {
    console.error("Пароль должен содержать не менее 12 символов.");
    process.exitCode = 1;
    return;
  }
  console.log(await bcrypt.hash(password, 12));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
