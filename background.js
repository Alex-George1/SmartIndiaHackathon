// Initialize the hash table (Object) for storing download links and hashes
let downloadLinksTable = {};

// Function to inject a custom modal popup into the active tab
function showAlertInActiveTab(downloadId, downloadUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const activeTab = tabs[0];
        chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: showCustomModal,
            args: [downloadId, downloadUrl]
        });
    });
}

// Function that will be injected into the page to create a custom modal popup
function showCustomModal(downloadId, downloadUrl) {
    // Remove any existing modal if already present
    const existingModal = document.getElementById('download-duplicate-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Create the modal container
    const modal = document.createElement('div');
    modal.id = 'download-duplicate-modal';
    modal.style.position = 'fixed';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.zIndex = '9999';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';

    // Create the modal content
    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = '#fff';
    modalContent.style.padding = '20px';
    modalContent.style.borderRadius = '10px';
    modalContent.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    modalContent.style.textAlign = 'center';

    // Add the extension name
    const header = document.createElement('h2');
    header.textContent = 'Extension';
    modalContent.appendChild(header);

    // Add the message
    const message = document.createElement('p');
    message.textContent = `Duplicate download detected for URL: ${downloadUrl}`;
    modalContent.appendChild(message);

    // Add "Cancel Download" button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel Download';
    cancelButton.style.marginRight = '10px';
    cancelButton.onclick = function() {
        chrome.runtime.sendMessage({ action: 'cancelDownload', downloadId: downloadId });
        modal.remove(); // Remove modal after cancelling the download
    };
    modalContent.appendChild(cancelButton);

    // Add "Continue Download" button
    const continueButton = document.createElement('button');
    continueButton.textContent = 'Continue Download';
    continueButton.onclick = function() {
        chrome.runtime.sendMessage({ action: 'continueDownload', downloadId: downloadId });
        modal.remove(); // Remove modal after resuming the download
    };
    modalContent.appendChild(continueButton);

    // Append the modal content to the modal container
    modal.appendChild(modalContent);

    // Append the modal to the body
    document.body.appendChild(modal);
}

// Function to compute a hash for the URL
async function computeHashForUrl(url) {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Listen for download creation events
chrome.downloads.onCreated.addListener(function (downloadItem) {
    const downloadId = downloadItem.id;
    const downloadUrl = downloadItem.url;

    // Always compute the hash for the URL
    computeHashForUrl(downloadUrl).then(hash => {
        console.log(hash);
        chrome.storage.sync.get({ downloadLinksTable: {} }, function (result) {
            let downloadLinksTable = result.downloadLinksTable;

            // Check if the URL already exists in the hash table
            const urlExists = Object.values(downloadLinksTable).some(entry => entry.url === downloadUrl);

            if (urlExists) {
                // If the URL already exists, show the duplicate alert
                chrome.downloads.pause(downloadId, function() {
                    if (chrome.runtime.lastError) {
                        console.log("Failed to pause download:", chrome.runtime.lastError);
                    } else {
                        console.log('Download paused for duplicate URL:', downloadUrl);
                        showAlertInActiveTab(downloadId, downloadUrl); // Show custom modal after pausing
                    }
                });
            }

            // Check if the hash already exists in the hash table
            const hashExists = Object.values(downloadLinksTable).some(entry => entry.hash === hash);

            if (!urlExists && hashExists) {
                // If the hash is a duplicate but the URL is not the same, show the duplicate alert
                chrome.downloads.pause(downloadId, function() {
                    if (chrome.runtime.lastError) {
                        console.log("Failed to pause download:", chrome.runtime.lastError);
                    } else {
                        console.log('Download paused for duplicate hash:', hash);
                        showAlertInActiveTab(downloadId, downloadUrl); // Show custom modal after pausing
                    }
                });
            }

            // Store the URL and hash in pending downloads after download completion
            chrome.storage.sync.get({ pendingDownloads: {} }, function (result) {
                let pendingDownloads = result.pendingDownloads || {};
                pendingDownloads[downloadId] = { url: downloadUrl, hash: hash };

                chrome.storage.sync.set({ pendingDownloads: pendingDownloads }, function () {
                    console.log('Pending download link stored:', downloadUrl);
                });
            });
        });
    });
});

// Listen for download changes to track completion and cancellation
chrome.downloads.onChanged.addListener(function (downloadDelta) {
    const downloadId = downloadDelta.id;

    if (downloadDelta.state) {
        if (downloadDelta.state.current === "complete") {
            // Handle completed downloads
            chrome.storage.sync.get({ pendingDownloads: {} }, function (result) {
                let pendingDownloads = result.pendingDownloads || {};
                const downloadData = pendingDownloads[downloadId];

                if (downloadData) {
                    const { url, hash } = downloadData;

                    // Remove the entry from pendingDownloads and add to downloadLinksTable
                    delete pendingDownloads[downloadId];
                    chrome.storage.sync.set({ pendingDownloads: pendingDownloads }, function () {
                        console.log('Pending download link removed:', url);
                    });

                    chrome.storage.sync.get({ downloadLinksTable: {} }, function (result) {
                        let downloadLinksTable = result.downloadLinksTable || {};
                        downloadLinksTable[downloadId] = { url, hash };

                        chrome.storage.sync.set({ downloadLinksTable: downloadLinksTable }, function () {
                            console.log('Download link and hash added to table:', url, hash);
                        });
                    });
                }
            });
        } else if (downloadDelta.state.current === "interrupted") {
            // Handle canceled or interrupted downloads
            chrome.storage.sync.get({ pendingDownloads: {} }, function (result) {
                let pendingDownloads = result.pendingDownloads || {};
                const downloadData = pendingDownloads[downloadId];

                if (downloadData) {
                    const { url } = downloadData;

                    // Remove the entry from pendingDownloads if the download is interrupted
                    delete pendingDownloads[downloadId];
                    chrome.storage.sync.set({ pendingDownloads: pendingDownloads }, function () {
                        console.log('Pending download link removed due to interruption:', url);
                    });
                }
            });
        }
    }
});

// Listen for messages from the content script to handle download actions
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'cancelDownload') {
        chrome.downloads.cancel(message.downloadId, function() {
            console.log('Download canceled:', message.downloadId);
        });
    } else if (message.action === 'continueDownload') {
        chrome.downloads.resume(message.downloadId, function() {
            console.log('Download resumed:', message.downloadId);
        });
    }
});
