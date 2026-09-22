const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const cameraInput = document.getElementById('camera-input');
const preview = document.getElementById('preview');
const scanButton = document.getElementById('scan-button');
const fileStatus = document.getElementById('file-status');
let selectedFile = null;
let objectUrl = null;
let addressDatabase = [];
let databaseReady = false;
const minimumMatchScore = 0.65;

function setFile(file) {
	if (!file || !file.type.startsWith('image/')) {
		fileStatus.textContent = 'Please choose a JPG, PNG or WEBP image';
		return;
	}
	if (file.size > 10 * 1024 * 1024) {
		fileStatus.textContent = 'That image is larger than 10 MB';
		return;
	}
	selectedFile = file;
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = URL.createObjectURL(file);
	preview.src = objectUrl;
	dropzone.classList.add('has-image');
	fileStatus.textContent = file.name;
	scanButton.disabled = false;
}

function clearFile() {
	selectedFile = null;
	fileInput.value = '';
	cameraInput.value = '';
	dropzone.classList.remove('has-image');
	preview.removeAttribute('src');
	fileStatus.textContent = 'No image selected';
	scanButton.disabled = true;
}

function normalizeAddress(value) {
	return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d{3})\s+(\d{2})/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '|');
}

function getAddressFromFields() {
	return ['address-name', 'address-street', 'address-postcode', 'address-city', 'address-country']
		.map(id => document.getElementById(id).value.trim())
		.filter(Boolean)
		.join('\n');
}

function fillAddressFields(address) {
	const lines = address.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	const postcodeIndex = lines.findIndex(line => /\b\d{3}\s?\d{2}\b/.test(line));
	const postcodeLine = postcodeIndex >= 0 ? lines[postcodeIndex] : '';
	const postcodeMatch = postcodeLine.match(/\b\d{3}\s?\d{2}\b/);
	document.getElementById('address-name').value = lines[0] || '';
	document.getElementById('address-street').value = lines[1] || '';
	document.getElementById('address-postcode').value = postcodeMatch ? postcodeMatch[0] : '';
	document.getElementById('address-city').value = postcodeLine.replace(postcodeMatch ? postcodeMatch[0] : '', '').trim() || lines[2] || '';
	document.getElementById('address-country').value = lines[postcodeIndex >= 0 ? postcodeIndex + 1 : 3] || '';
}

function prepareImageForOcr(file) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const scale = Math.max(1, Math.min(2, 1800 / image.width));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(image.width * scale);
			canvas.height = Math.round(image.height * scale);
			const context = canvas.getContext('2d', { willReadFrequently: true });
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
			for (let index = 0; index < pixels.data.length; index += 4) {
				const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
				const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
				pixels.data[index] = contrast;
				pixels.data[index + 1] = contrast;
				pixels.data[index + 2] = contrast;
			}
			context.putImageData(pixels, 0, 0);
			resolve(canvas);
		};
		image.onerror = reject;
		image.src = URL.createObjectURL(file);
	});
}

async function loadAddressDatabase() {
	try {
		const response = await fetch('register.json', { cache: 'no-store' });
		if (!response.ok) throw new Error('Database request failed');
		const records = await response.json();
		addressDatabase = records
			.filter(record => record.bor_kvar)
			.map(record => ({
				record,
				key: normalizeAddress(record.namn + '\n' + record.gata + '\n' + record.postnummer + ' ' + record.ort + '\nSweden')
			}));
		databaseReady = true;
		fileStatus.textContent = '';
	} catch (error) {
		console.error('Could not load register.json', error);
		fileStatus.textContent = 'Could not load the address database. Check the Render files.';
	}
}

function similarity(first, second) {
	if (first === second) return 1;
	if (!first || !second) return 0;
	const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
	for (let row = 1; row <= first.length; row += 1) {
		let diagonal = previous[0];
		previous[0] = row;
		for (let column = 1; column <= second.length; column += 1) {
			const saved = previous[column];
			previous[column] = Math.min(
				previous[column] + 1,
				previous[column - 1] + 1,
				diagonal + (first[row - 1] === second[column - 1] ? 0 : 1)
			);
			diagonal = saved;
		}
	}
	return 1 - previous[second.length] / Math.max(first.length, second.length);
}

function findClosestAddress(addressKey) {
	return addressDatabase
		.map(entry => ({ ...entry, score: similarity(addressKey, entry.key) }))
		.sort((first, second) => second.score - first.score)[0];
}

function renderClosestMatch(match, exactMatch) {
	const container = document.getElementById('closest-match');
	if (!match || (!exactMatch && match.score < minimumMatchScore)) {
		container.hidden = true;
		return;
	}
	const confidence = Math.round(match.score * 100);
	container.hidden = false;
	container.className = 'closest-match ' + (exactMatch ? 'exact' : 'suggestion');
	container.innerHTML = '<strong>' + (exactMatch ? 'Matched database address' : 'Closest database address') + '</strong>' +
		'<span>' + match.record.namn + '</span>' +
		'<span>' + match.record.gata + '</span>' +
		'<span>' + match.record.postnummer + ' ' + match.record.ort + '</span>' +
		'<small>' + (exactMatch ? 'Exact match' : confidence + '% similarity · Review this suggestion') + '</small>';
}

function renderResults(address) {
	fillAddressFields(address);
	const name = document.getElementById('address-name').value.trim();
	const street = document.getElementById('address-street').value.trim();
	const postcode = document.getElementById('address-postcode').value.trim();
	const city = document.getElementById('address-city').value.trim();
	const country = document.getElementById('address-country').value.trim();
	const addressKey = normalizeAddress(getAddressFromFields());
	const closestMatch = findClosestAddress(addressKey);
	const addressExists = closestMatch?.key === addressKey;
	const reliableMatch = addressExists || closestMatch?.score >= minimumMatchScore;
	renderClosestMatch(reliableMatch ? closestMatch : null, addressExists);
	const matchPercentage = addressExists ? 100 : Math.round((closestMatch?.score || 0) * 100);
	const checks = [
		{ type: street && /\d/.test(street) ? 'pass' : 'warn', title: street && /\d/.test(street) ? 'Street address found' : 'Street address needs review', detail: street && /\d/.test(street) ? 'House number and street name were detected.' : 'Check the street and house number field.' },
		{ type: /^\d{3}\s?\d{2}$/.test(postcode) ? 'pass' : 'warn', title: /^\d{3}\s?\d{2}$/.test(postcode) ? 'Postcode format valid' : 'Postcode needs review', detail: /^\d{3}\s?\d{2}$/.test(postcode) ? 'The postcode matches the local format.' : 'Check the five-digit postcode.' },
		{ type: city && country ? 'pass' : 'warn', title: city && country ? 'City and country found' : 'City or country needs review', detail: city && country ? 'Both destination fields are present.' : 'Check the city and country fields.' },
		{ type: addressExists ? 'pass' : 'fail', title: addressExists ? 'Address exists in database' : 'Address missing from database', detail: addressExists ? 'The scanned address matches a registered address.' : reliableMatch ? 'A similar address was found; review the suggestion.' : 'No reliable matching address was found.' }
	];
	document.getElementById('score').textContent = matchPercentage + '%';
	document.getElementById('result-summary').innerHTML = addressExists ? '<strong>Address verified.</strong> The scanned address exists in the database.' : '<strong>Address incorrect or unknown.</strong> The scanned address is missing from the database.';
	document.getElementById('database-status').className = 'database-status ' + (addressExists ? 'exists' : 'missing');
	document.getElementById('database-status').textContent = addressExists ? '✓ Address exists in database' : reliableMatch ? '! Address missing · possible match found' : '! Address missing · no reliable match';
	document.getElementById('checks').innerHTML = checks.map(check => '<div class="check ' + check.type + '"><div class="check-icon">' + (check.type === 'pass' ? '✓' : '!') + '</div><div><strong>' + check.title + '</strong><span>' + check.detail + '</span></div></div>').join('');
	document.getElementById('empty-state').style.display = 'none';
	document.getElementById('results').classList.add('visible');
}

async function scanAddress() {
	if (!selectedFile || !databaseReady) return;
	if (!window.Tesseract) {
		fileStatus.textContent = 'OCR is still loading. Check your internet connection and try again.';
		return;
	}
	scanButton.disabled = true;
	scanButton.innerHTML = 'Reading address <span aria-hidden="true">…</span>';
	fileStatus.textContent = 'Analysing letter image';
	try {
		fileStatus.textContent = 'Improving image quality';
		const preparedImage = await prepareImageForOcr(selectedFile);
		const result = await Tesseract.recognize(preparedImage, 'swe+eng', {
			 tessedit_pageseg_mode: '6',
			logger: message => {
				if (message.status === 'recognizing text') fileStatus.textContent = 'Reading address ' + Math.round(message.progress * 100) + '%';
			}
		});
		const extractedAddress = result.data.text.trim();
		if (!extractedAddress) throw new Error('No address text detected');
		renderResults(extractedAddress);
		scanButton.innerHTML = 'Scan again <span aria-hidden="true">→</span>';
		fileStatus.textContent = result.data.confidence < 55 ? 'Scan complete · please review the extracted fields' : selectedFile.name + ' · scanned just now';
	} catch (error) {
		console.error('Could not read the letter image', error);
		fileStatus.textContent = 'No address text was detected. Try a clearer image.';
		scanButton.innerHTML = 'Try scan again <span aria-hidden="true">→</span>';
	} finally {
		scanButton.disabled = false;
	}
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
cameraInput.addEventListener('change', () => setFile(cameraInput.files[0]));
scanButton.addEventListener('click', scanAddress);
dropzone.addEventListener('drop', event => setFile(event.dataTransfer.files[0]));
['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => {
	event.preventDefault();
	dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => {
	event.preventDefault();
	dropzone.classList.remove('dragging');
}));
document.getElementById('replace-button').addEventListener('click', () => fileInput.click());
document.getElementById('clear-button').addEventListener('click', clearFile);
document.getElementById('copy-button').addEventListener('click', event => {
	navigator.clipboard.writeText(getAddressFromFields());
	event.currentTarget.textContent = 'Copied';
	window.setTimeout(() => { event.currentTarget.textContent = 'Copy address'; }, 1400);
});
document.getElementById('edit-button').addEventListener('click', event => {
	const fields = document.querySelectorAll('#address-fields input');
	const isEditing = event.currentTarget.dataset.editing === 'true';
	fields.forEach(field => { field.disabled = isEditing; });
	event.currentTarget.dataset.editing = String(!isEditing);
	event.currentTarget.textContent = isEditing ? 'Correct address' : 'Check corrected address';
	if (isEditing) {
		renderResults(getAddressFromFields());
		event.currentTarget.textContent = 'Correct address';
	} else {
		document.getElementById('address-name').focus();
	}
});

loadAddressDatabase();
