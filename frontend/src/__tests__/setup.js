import '@testing-library/jest-dom';

// i18n:测试环境强制 zh-CN,让接了 t() 的组件渲染中文(与既有断言一致;
// 不初始化则 useTranslation 的 t() 返回原始键 / jsdom 探测到 en → 断言失败)。
import i18n from '../i18n/index.js';
i18n.changeLanguage('zh-CN');
