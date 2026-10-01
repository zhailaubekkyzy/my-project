// scripts/test-auth-isolation.js - Verification Report CLI for Stage 1
const { runAllTests } = require('../test/stage1.test');

console.log('Запуск комплексной проверки безопасности и авторизации SmartFlow (Этап 1)...');
runAllTests().then(() => {
  console.log('\n[SmartFlow Report] Все 14 обязательных проверок Этапа 1 успешно пройдены!');
  process.exit(0);
}).catch(err => {
  console.error('\n[SmartFlow Report] Ошибка тестирования:', err);
  process.exit(1);
});
