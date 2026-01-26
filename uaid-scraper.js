const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const axios = require('axios');
const express = require('express');

// Configuration - Environment variables for Railway
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://discord.com/api/webhooks/1465266631335739518/D26OxmuPnon4kDh8AK5TeLBnF4c86oV7C5voXwxMDRxUPWliRrwBZQrPcWu4X4ylQWm7';
const USERNAME_WEBHOOK_URL = process.env.USERNAME_WEBHOOK_URL || 'https://discord.com/api/webhooks/1465281642913599563/37S2bQWecCwslpK6tZXcPc9GunYvrnFY21BMcW8Llh0fbUyquhlN3TWx4Y8vv5K7a3ym';
const ITEM_IDS = process.env.ITEM_IDS || '439946249,180660043,1016143686,98346834,1191135761,250395631,416846000,398676450,42211680';
const NEXUS_ADMIN_KEY = process.env.NEXUS_ADMIN_KEY;
const NEXUS_API_URL = 'https://discord.nexusdevtools.com/lookup/roblox';

// Speed settings
const PAGE_LOAD_WAIT = 2000;
const TABLE_WAIT = 1500;
const PROFILE_CHECK_WAIT = 2000;
const BETWEEN_CHECKS_WAIT = 500;
const PAGES_PER_BATCH = 10;

let driver;
let processedUAIDs = new Set();
let totalFound = 0;
let isScraping = false;

// Express server for Railway health check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        scraping: isScraping,
        totalFound: totalFound,
        processedUAIDs: processedUAIDs.size,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

async function initializeWebDriver() {
    try {
        console.log('🔧 Initializing Selenium WebDriver...');

        const options = new chrome.Options();
        options.addArguments('--headless=new');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments('--window-size=1920,1080');
        options.addArguments('--disable-web-security');
        options.addArguments('--disable-features=VizDisplayCompositor');
        options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        options.addArguments('--disable-blink-features=AutomationControlled');

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        console.log('✅ Selenium WebDriver initialized');
        return true;
    } catch (error) {
        console.error('❌ WebDriver initialization error:', error.message);
        return false;
    }
}

function extractDiscordFromRecord(record) {
    if (!record || typeof record !== 'object') return null;
    
    // Prefer explicit fields if present
    if (record.discord_tag) return String(record.discord_tag);
    if (record.discord_username && record.discriminator) {
        return `${record.discord_username}#${record.discriminator}`;
    }
    if (record.discord_username) return String(record.discord_username);
    
    // Nexus /lookup/roblox returns objects like: { "username": "<discord username>", ... }
    if (record.username) return String(record.username);
    
    // Fallback: any field whose key mentions "discord"
    const key = Object.keys(record).find(k => k.toLowerCase().includes('discord'));
    if (key && record[key]) {
        return String(record[key]);
    }
    
    return null;
}

async function lookupDiscordUsername(robloxUsername) {
    if (!NEXUS_ADMIN_KEY) {
        console.log(`  ⚠️ NEXUS_ADMIN_KEY not set, skipping Discord lookup`);
        return null;
    }
    
    try {
        const response = await axios.get(NEXUS_API_URL, {
            params: { query: robloxUsername },
            headers: { 'x-admin-key': NEXUS_ADMIN_KEY }
        });
        
        const body = response.data || {};
        const records = Array.isArray(body.data) ? body.data : [];
        
        if (!records.length) {
            console.log(`  ℹ️ No Discord found for ${robloxUsername}`);
            return null;
        }
        
        const discordRecord = records[0];
        const discordValue = extractDiscordFromRecord(discordRecord);
        
        if (!discordValue) {
            console.log(`  ℹ️ Could not extract Discord from Nexus response for ${robloxUsername}`);
            return null;
        }
        
        console.log(`  🎮 Discord found: ${discordValue}`);
        return discordValue;
        
    } catch (error) {
        console.error(`  ❌ Nexus API error for ${robloxUsername}:`, error.message);
        return null;
    }
}

async function sendToWebhook(userData) {
    console.log(`📤 Sending embed to webhook: ${userData.username}`);
    try {
        const embed = {
            title: "✨ New Profile Found!",
            color: 0x00AE86,
            fields: [
                {
                    name: "Discord Username",
                    value: userData.discord || " ",
                    inline: false
                },
                {
                    name: "Roblox Username",
                    value: userData.username,
                    inline: true
                },
                {
                    name: "Rolimons Profile",
                    value: `[View Profile](${userData.profileUrl})`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString()
        };
        
        // Add avatar thumbnail if available
        if (userData.avatarUrl) {
            embed.thumbnail = { url: userData.avatarUrl };
        }
        
        const payload = { embeds: [embed] };
        
        const response = await axios.post(WEBHOOK_URL, payload);
        console.log('✅ Webhook sent successfully, status:', response.status);
        
        // Send Discord username only to the username webhook (if Discord was found)
        if (userData.discord) {
            await sendUsernameToWebhook(userData.discord);
        }
        
        return true;
    } catch (e) {
        console.error('❌ Webhook POST error:', e.message);
        if (e.response) {
            console.error('Response status:', e.response.status);
        }
        return false;
    }
}

async function sendUsernameToWebhook(discordUsername) {
    try {
        const payload = { content: discordUsername };
        const response = await axios.post(USERNAME_WEBHOOK_URL, payload);
        console.log('✅ Username webhook sent, status:', response.status);
        return true;
    } catch (e) {
        console.error('❌ Username webhook error:', e.message);
        return false;
    }
}

async function checkUserHasAvatar(profileUrl) {
    try {
        await driver.get(profileUrl);
        await driver.sleep(PROFILE_CHECK_WAIT);

        // Try to find the avatar image element specifically
        // Rolimons uses img with class containing avatar or specific container
        const avatarSelectors = [
            'img.mx-auto.d-block.w-100.h-100',
            'img[src*="rbxcdn.com"]',
            '.player-avatar img',
            '#player_avatar img'
        ];
        
        for (const selector of avatarSelectors) {
            try {
                const avatarImg = await driver.findElement(By.css(selector));
                const src = await avatarImg.getAttribute('src');
                
                if (src) {
                    // Check if it's the terminated placeholder
                    if (src.includes('transparent-square') || src.includes('placeholder')) {
                        console.log(`  ❌ TERMINATED (placeholder avatar)`);
                        return { valid: false, avatarUrl: null };
                    }
                    
                    // Check if it's a valid rbxcdn avatar
                    if (src.includes('rbxcdn.com')) {
                        console.log(`  ✅ Valid: ${src.substring(0, 50)}...`);
                        return { valid: true, avatarUrl: src };
                    }
                }
            } catch (e) {
                // Selector not found, try next
                continue;
            }
        }
        
        // Fallback: check page source for avatar patterns
        const pageSource = await driver.getPageSource();
        
        // Look for valid rbxcdn avatar URL first (prioritize finding valid)
        const avatarMatch = pageSource.match(/https:\/\/tr\.rbxcdn\.com\/[^"'\s]+Avatar[^"'\s]*/i);
        if (avatarMatch) {
            const avatarUrl = avatarMatch[0];
            console.log(`  ✅ Valid (source): ${avatarUrl.substring(0, 50)}...`);
            return { valid: true, avatarUrl: avatarUrl };
        }
        
        // Check for any rbxcdn image
        const rbxcdnMatch = pageSource.match(/https:\/\/tr\.rbxcdn\.com\/[^"'\s]+/i);
        if (rbxcdnMatch) {
            const avatarUrl = rbxcdnMatch[0];
            console.log(`  ✅ Valid (rbxcdn): ${avatarUrl.substring(0, 50)}...`);
            return { valid: true, avatarUrl: avatarUrl };
        }
        
        // Only mark as terminated if we explicitly find the placeholder AND no valid avatar
        // Check if terminated placeholder exists in a specific context
        if (pageSource.includes('transparent-square-110.png') && !pageSource.includes('tr.rbxcdn.com')) {
            console.log(`  ❌ TERMINATED (no valid avatar found)`);
            return { valid: false, avatarUrl: null };
        }
        
        // Default: assume valid if we can't determine
        console.log(`  ⚠️ Could not determine avatar status, assuming valid`);
        return { valid: true, avatarUrl: null };
        
    } catch (error) {
        console.error('  ⚠️ Error checking avatar:', error.message);
        return { valid: true, avatarUrl: null };
    }
}

async function findPreviousOwnerFromUAID(uaidUrl) {
    try {
        await driver.get(uaidUrl);
        await driver.sleep(PAGE_LOAD_WAIT);

        // Collect potential owners from recorded owners section
        let potentialOwners = [];
        
        try {
            const playerLinks = await driver.findElements(By.css('a[href*="/player/"]'));
            
            for (const link of playerLinks) {
                try {
                    const href = await link.getAttribute('href');
                    const text = await link.getText();
                    
                    if (!text || !text.trim()) continue;
                    if (text.includes('Deleted') || text.includes('Hidden')) continue;
                    
                    const username = text.trim();
                    let profileUrl = href;
                    if (!profileUrl.startsWith('http')) {
                        profileUrl = `https://www.rolimons.com${href}`;
                    }
                    
                    if (!potentialOwners.find(o => o.username === username)) {
                        potentialOwners.push({ username, profileUrl });
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (e) {}

        // Check each owner for valid avatar and return full user data
        for (const owner of potentialOwners) {
            const avatarCheck = await checkUserHasAvatar(owner.profileUrl);
            
            if (avatarCheck.valid) {
                return {
                    username: owner.username,
                    profileUrl: owner.profileUrl,
                    avatarUrl: avatarCheck.avatarUrl,
                    discord: ""  // Blank for now, will use later
                };
            }
            
            await driver.sleep(BETWEEN_CHECKS_WAIT);
        }

        return null;
        
    } catch (error) {
        return null;
    }
}

async function navigateToItemPage(url) {
    await driver.get(url);
    await driver.sleep(PAGE_LOAD_WAIT);
    
    // Click "All Copies" tab
    const allCopiesTab = await driver.findElement(By.css('a[href="#all_copies_table_container"]'));
    await driver.executeScript('arguments[0].click();', allCopiesTab);
    await driver.sleep(TABLE_WAIT);
    await driver.wait(until.elementLocated(By.css('#all_copies_table tbody tr')), 15000);
}

async function navigateToPage(targetPage, totalPages) {
    // Click to specific page - first try direct click, then use pagination
    try {
        const pageBtn = await driver.findElement(By.xpath(`//a[contains(@class, 'page-link') and text()='${targetPage}']`));
        await driver.executeScript('arguments[0].click();', pageBtn);
        await driver.sleep(TABLE_WAIT);
        return true;
    } catch (e) {
        // Page button not visible, need to navigate using next/prev
        // Go to last page first, then work backwards
        try {
            const lastPageBtn = await driver.findElement(By.xpath(`//a[contains(@class, 'page-link') and text()='${totalPages}']`));
            await driver.executeScript('arguments[0].click();', lastPageBtn);
            await driver.sleep(TABLE_WAIT);
            
            // Click prev until we reach target
            for (let p = totalPages; p > targetPage; p--) {
                const prevLink = await driver.findElement(By.css('#all_copies_table_paginate a.page-link[data-dt-idx="0"]'));
                await driver.executeScript('arguments[0].click();', prevLink);
                await driver.sleep(TABLE_WAIT);
            }
            return true;
        } catch (e2) {
            return false;
        }
    }
}

async function collectUAIDsFromCurrentPage() {
    let uaids = [];
    const rows = await driver.findElements(By.css('#all_copies_table tbody tr'));
    
    for (let i = rows.length - 1; i >= 0; i--) {
        try {
            const row = rows[i];
            
            // Check if deleted/hidden (no player link)
            let hasPlayerLink = false;
            try {
                const playerLink = await row.findElement(By.css('a[href*="/player/"]'));
                const playerText = await playerLink.getText();
                if (playerText && playerText.trim() && !playerText.includes('Deleted') && !playerText.includes('Hidden')) {
                    hasPlayerLink = true;
                }
            } catch (e) {
                hasPlayerLink = false;
            }

            if (!hasPlayerLink) {
                try {
                    const uaidElement = await row.findElement(By.css('a[href*="/uaid/"]'));
                    const uaidHref = await uaidElement.getAttribute('href');
                    const uaidText = await uaidElement.getText();
                    
                    let uaidUrl = uaidHref;
                    if (!uaidUrl.startsWith('http')) {
                        uaidUrl = `https://www.rolimons.com${uaidHref}`;
                    }
                    
                    if (!processedUAIDs.has(uaidText)) {
                        uaids.push({ uaid: uaidText, url: uaidUrl });
                        processedUAIDs.add(uaidText);
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
    
    return uaids;
}

async function scrapeItemForDeletedUsers(itemId) {
    try {
        const url = `https://www.rolimons.com/item/${itemId}`;
        console.log(`\n🔍 Scraping item: ${url}`);
        
        await driver.get(url);
        await driver.sleep(PAGE_LOAD_WAIT);

        // Get item name
        let itemName = 'Unknown Item';
        try {
            const titleElement = await driver.findElement(By.css('h1.page_title.mb-0'));
            itemName = await titleElement.getText();
            console.log(`📦 Item: ${itemName}`);
        } catch (e) {}

        // Click "All Copies" tab
        try {
            const allCopiesTab = await driver.findElement(By.css('a[href="#all_copies_table_container"]'));
            await driver.executeScript('arguments[0].click();', allCopiesTab);
            await driver.sleep(TABLE_WAIT);
            await driver.wait(until.elementLocated(By.css('#all_copies_table tbody tr')), 15000);
        } catch (e) {
            console.log('❌ Could not load All Copies table:', e.message);
            return;
        }

        // Find total pages
        let totalPages = 1;
        try {
            await driver.wait(until.elementLocated(By.css('#all_copies_table_paginate')), 10000);
            const pageButtons = await driver.findElements(By.css('#all_copies_table_paginate a.page-link[data-dt-idx]'));
            
            for (const button of pageButtons) {
                const text = (await button.getText()).trim();
                if (/^\d+$/.test(text)) {
                    const pageNum = parseInt(text, 10);
                    if (pageNum > totalPages) totalPages = pageNum;
                }
            }
        } catch (e) {}
        
        console.log(`📄 Found ${totalPages} pages (processing ${PAGES_PER_BATCH} at a time)`);

        // Process in batches of PAGES_PER_BATCH pages
        let currentPage = totalPages;
        let batchNum = 0;
        
        while (currentPage >= 1) {
            batchNum++;
            const batchEnd = currentPage;
            const batchStart = Math.max(1, currentPage - PAGES_PER_BATCH + 1);
            
            console.log(`\n📦 Batch ${batchNum}: Pages ${batchEnd} → ${batchStart}`);
            
            // Navigate to starting page of this batch
            await navigateToItemPage(url);
            if (batchEnd > 1) {
                await navigateToPage(batchEnd, totalPages);
            }
            
            // Collect UAIDs from this batch of pages
            let batchUAIDs = [];
            
            for (let page = batchEnd; page >= batchStart; page--) {
                if (page !== batchEnd) {
                    try {
                        const prevLink = await driver.findElement(By.css('#all_copies_table_paginate a.page-link[data-dt-idx="0"]'));
                        await driver.executeScript('arguments[0].click();', prevLink);
                        await driver.sleep(TABLE_WAIT);
                    } catch (e) {
                        break;
                    }
                }
                
                const pageUAIDs = await collectUAIDsFromCurrentPage();
                batchUAIDs.push(...pageUAIDs);
                console.log(`  Page ${page}: ${pageUAIDs.length} UAIDs (batch total: ${batchUAIDs.length})`);
            }
            
            // Process this batch
            if (batchUAIDs.length > 0) {
                console.log(`\n⚡ Processing ${batchUAIDs.length} UAIDs from batch ${batchNum}...`);
                
                for (let i = 0; i < batchUAIDs.length; i++) {
                    const { uaid, url: uaidUrl } = batchUAIDs[i];
                    console.log(`[${i + 1}/${batchUAIDs.length}] UAID: ${uaid}`);
                    
                    const userData = await findPreviousOwnerFromUAID(uaidUrl);
                    
                    if (userData) {
                        console.log(`  ✨ Found: ${userData.username}`);
                        
                        // Lookup Discord username via Nexus API
                        const discordUsername = await lookupDiscordUsername(userData.username);
                        userData.discord = discordUsername || "";
                        
                        await sendToWebhook(userData);
                        totalFound++;
                    } else {
                        console.log(`  ❌ No valid owner`);
                    }
                }
            } else {
                console.log(`  No deleted/hidden users in this batch`);
            }
            
            // Move to next batch
            currentPage = batchStart - 1;
        }
        
        console.log(`\n✅ Finished item ${itemId}. Total found: ${totalFound}`);
        
    } catch (error) {
        console.error('❌ Error scraping item:', error.message);
    }
}

async function main() {
    console.log('🚀 UAID Previous Owner Scraper');
    console.log('================================');
    console.log('This script finds Deleted/Hidden users and looks up their previous owners.\n');
    
    // Check Nexus API configuration
    if (NEXUS_ADMIN_KEY) {
        console.log('✅ Nexus API configured - Discord lookups enabled');
    } else {
        console.log('⚠️ NEXUS_ADMIN_KEY not set - Discord lookups disabled');
    }
    console.log('');
    
    const initialized = await initializeWebDriver();
    if (!initialized) {
        console.error('❌ Failed to initialize WebDriver');
        process.exit(1);
    }

    const itemIds = ITEM_IDS.split(',').map(id => id.trim()).filter(id => id && !isNaN(id));
    console.log(`📋 Will scrape ${itemIds.length} items: ${itemIds.join(', ')}\n`);

    isScraping = true;
    
    for (const itemId of itemIds) {
        await scrapeItemForDeletedUsers(itemId);
    }

    isScraping = false;
    console.log('\n================================');
    console.log(`🏁 All done! Total previous owners found: ${totalFound}`);
    
    await driver.quit();
    console.log('✅ Scraping complete. Server still running for health checks.');
}

// Handle cleanup
process.on('SIGINT', async () => {
    console.log('\n🧹 Cleaning up...');
    if (driver) {
        try { await driver.quit(); } catch (e) {}
    }
    process.exit(0);
});

main();
