// ==UserScript==
// @name         Reddit Auto-Translator (Optimized)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Быстрый перевод постов и комментариев на Reddit
// @author       Deepseek to Morty3333|Mortu3333
// @match        https://www.reddit.com/*
// @icon         https://www.redditstatic.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ========== КОНФИГУРАЦИЯ ==========
    const config = {
        targetLanguage: 'ru',          // Язык перевода (ru)
        detectLanguage: 'auto',        // Автоопределение языка
        translatePosts: true,          // Переводить посты
        translateComments: true,       // Переводить комментарии
        showLoadingIndicator: true,    // Показать "Перевод..."
        showOriginalOnHover: true,     // Показать оригинал при наведении
        maxLength: 5000,               // Макс. длина текста
        delayBetweenRequests: 1500,    // Увеличенная задержка
        maxConcurrentRequests: 2,      // Макс. одновременных запросов
        visibleElementsFirst: true,    // Сначала переводить видимые элементы
        commentSelectors: [
            '[data-testid="comment"]',
            'div[id^="comment-"]',
            'div.Comment',
            'div.comment',
            'div.thing.comment',
            'shreddit-comment'
        ],
        postTextSelectors: [
            '[data-test-id="post-content"]',
            '[data-click-id="text"]',
            '.Post__content',
            '.RichTextJSON-root',
            '.selftext',
            '.md',
            '.usertext-body',
            'div[slot="text-body"]',
            'shreddit-post div[slot="text-body"]',
            'div.text-content'
        ]
    };
    // ==================================

    // Очередь переводов
    const translationQueue = [];
    let activeRequests = 0;

    // Добавляем стили
    const addStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .reddit-translated {
                position: relative;
            }
            .translating-indicator {
                color: #888;
                font-style: italic;
            }
            .reddit-translated:hover {
                background-color: rgba(255, 215, 0, 0.1);
            }
        `;
        document.head.appendChild(style);
    };

    // Функция перевода
    const translateText = (text, callback) => {
        if (!text || text.length > config.maxLength) {
            callback(null);
            return;
        }

        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${config.detectLanguage}&tl=${config.targetLanguage}&dt=t&q=${encodeURIComponent(text)}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    let translated = '';
                    if (data && data[0]) {
                        data[0].forEach(item => {
                            if (item && item[0]) translated += item[0];
                        });
                    }
                    callback(translated || null);
                } catch (e) {
                    console.error('Translation error:', e, response.responseText);
                    callback(null);
                }
                activeRequests--;
                processQueue();
            },
            onerror: function(error) {
                console.error('API error:', error);
                callback(null);
                activeRequests--;
                processQueue();
            }
        });
    };

    // Обработка очереди с приоритетом видимых элементов
    const processQueue = () => {
        if (translationQueue.length === 0) return;

        // Сначала обрабатываем видимые элементы
        if (config.visibleElementsFirst) {
            translationQueue.sort((a, b) => {
                const aVisible = isElementVisible(a.element) ? 1 : 0;
                const bVisible = isElementVisible(b.element) ? 1 : 0;
                return bVisible - aVisible;
            });
        }

        // Обрабатываем элементы, если есть свободные слоты
        while (activeRequests < config.maxConcurrentRequests && translationQueue.length > 0) {
            const {element, originalText} = translationQueue.shift();
            activeRequests++;

            if (config.showLoadingIndicator) {
                element.textContent = "Перевод...";
                element.classList.add('translating-indicator');
            }

            translateText(originalText, function(translated) {
                if (translated) {
                    element.textContent = translated;
                    element.classList.add('reddit-translated');
                    element.classList.remove('translating-indicator');

                    if (config.showOriginalOnHover) {
                        element.title = "Оригинал: " + originalText;
                        element.style.borderBottom = "1px dashed #aaa";
                        element.style.cursor = "help";
                    }

                    element.dataset.originalText = originalText;
                    element.dataset.translated = "true";
                } else {
                    element.textContent = originalText;
                    element.classList.remove('translating-indicator');
                    element.dataset.translated = "error";
                }
            });
        }

        // Планируем следующую обработку
        if (translationQueue.length > 0) {
            setTimeout(processQueue, config.delayBetweenRequests);
        }
    };

    // Проверка видимости элемента
    const isElementVisible = (element) => {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    };

    // Добавление в очередь
    const addToQueue = (element) => {
        if (element.dataset.translated) return;

        const originalText = element.textContent.trim();
        if (!originalText || originalText.length < 3) return;

        element.dataset.translated = "queued";
        translationQueue.push({
            element: element,
            originalText: originalText
        });

        // Запускаем обработку, если нет активных запросов
        if (activeRequests === 0) {
            setTimeout(processQueue, 500);
        }
    };

    // ПОИСК ТОЛЬКО ТЕКСТА КОММЕНТАРИЕВ (ИСКЛЮЧАЕМ ИМЕНА)
    const findComments = () => {
        config.commentSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(comment => {
                const commentBody = comment.querySelector(`
                    [data-testid="comment"],
                    .Comment__body,
                    .comment-body,
                    .md,
                    .usertext-body,
                    [data-click-id="body"],
                    [data-test-id="comment-content"],
                    p
                `);

                if (commentBody) {
                    if (!commentBody.closest('header') &&
                        !commentBody.closest('.comment-header') &&
                        !commentBody.closest('.Comment__header') &&
                        !commentBody.matches('a[href*="/user/"]') &&
                        !commentBody.matches('.author')) {
                        addToQueue(commentBody);
                    }
                }
            });
        });
    };

    // ПОИСК ТЕКСТА ПОСТОВ
    const findPostText = () => {
        config.postTextSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(container => {
                if (container.matches('p, span, div')) {
                    addToQueue(container);
                }
                else {
                    const textElements = container.querySelectorAll('p, span, div');
                    if (textElements.length > 0) {
                        textElements.forEach(el => {
                            if (!el.closest('button, a, .icon, .vote, .title')) {
                                addToQueue(el);
                            }
                        });
                    } else {
                        addToQueue(container);
                    }
                }
            });
        });
    };

    // Поиск элементов для перевода
    const findElementsToTranslate = () => {
        try {
            if (config.translatePosts) {
                document.querySelectorAll('h1, h2, h3, [slot="title"], [id^="post-title"], [data-adclicklocation="title"]').forEach(addToQueue);
                findPostText();
            }

            if (config.translateComments) {
                findComments();
            }
        } catch (e) {
            console.error('Error in findElementsToTranslate:', e);
        }
    };

    // Основная функция инициализации
    const initTranslator = () => {
        console.log("Reddit Translator initializing...");
        addStyles();

        // Первоначальная обработка
        findElementsToTranslate();

        // Observer для нового контента
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length) {
                    setTimeout(findElementsToTranslate, 1000);
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Обработка при скролле (только для видимых элементов)
        window.addEventListener('scroll', () => {
            if (config.visibleElementsFirst) {
                processQueue();
            }
        });
    };

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTranslator);
    } else {
        setTimeout(initTranslator, 3000);
    }
})();