import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2/promise';
import { parse } from 'csv-parse/sync';

dotenv.config();

const app = express();
const port = process.env.PORT ?? 5000;

const defaultAllowedOrigins = [
	'https://app.northallertonrepaircafe.org.uk',
	'https://northallertonrepaircafe.org.uk',
	'http://localhost:5173',
];

const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');

const allowedOrigins = new Set(
	(process.env.CLIENT_ORIGIN
		? process.env.CLIENT_ORIGIN.split(',')
		: defaultAllowedOrigins
	)
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0)
		.map(normalizeOrigin),
);

app.use(
	cors({
		origin(origin, callback) {
			if (!origin) {
				callback(null, true);
				return;
			}

			const normalizedOrigin = normalizeOrigin(origin);
			if (allowedOrigins.has(normalizedOrigin)) {
				callback(null, true);
				return;
			}

			callback(new Error(`CORS origin not allowed: ${origin}`));
		},
	}),
);
app.use(express.json());

const getRequiredEnv = (name: string): string => {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
};

// 1. Declare the pool variable globally so your route endpoints can access it
let pool: mysql.Pool;

try {
    console.log("Validating environment keys and building database pool...");

    pool = mysql.createPool({
        host: getRequiredEnv('DB_HOST'),
        user: getRequiredEnv('DB_USER'),
        password: getRequiredEnv('DB_PASSWORD'),
        database: getRequiredEnv('DB_NAME'),
        waitForConnections: true,
        connectionLimit: 10,
    });

    console.log("Database connection pool initialized successfully.");
} catch (error: any) {
    // 2. This intercepts the "Missing required environment variable" error 
    // and explicitly surfaces it to Hostinger hPanel logs.
    console.error("❌ FATAL STARTUP ERROR:", error.message || error);
    
    // Terminate the process cleanly so the system registers the failure state
    process.exit(1);
}

type LookupGroup = 'source' | 'venue' | 'section' | 'repairer';

interface RepairPayload {
	rp_uid: number;
	rp_event: number;
	rp_item: string;
	rp_problem: string;
	rp_section: number;
	rp_source: number;
	rp_repairer: number;
	rp_tryfix: number;
	rp_fixed: number;
	rp_comments: string;
}

interface LookupRow extends RowDataPacket {
	lookup_id: number;
	lk_group: string;
	lk_name: string;
	lk_seq: number;
	lk_header: number;
}

interface EventRow extends RowDataPacket {
	event_id: number;
	ev_date: string;
	ev_venue: number;
	ev_comment: string;
	venue_name: string | null;
}

interface RepairRow extends RowDataPacket {
	repair_id: number;
	rp_uid: number;
	rp_event: number;
	rp_item: string;
	rp_problem: string;
	rp_section: number;
	rp_source: number;
	rp_repairer: number;
	rp_tryfix: number;
	rp_fixed: number;
	rp_comments: string;
	event_date: string;
	event_comment: string;
	venue_id: number;
	venue_name: string | null;
	section_name: string | null;
	source_name: string | null;
	repairer_name: string | null;
}

interface MaxUidRow extends RowDataPacket {
	max_uid: number | null;
}

interface CsvRepairRow {
	rp_uid: string;
	rp_event: string;
	rp_item: string;
	rp_problem: string;
	rp_section: string;
	rp_tryfix: string;
	rp_fixed: string;
	rp_source: string;
	rp_comment: string;
}

interface EventDateRow extends RowDataPacket {
	event_id: number;
	ev_date: string;
}

interface LookupCreateRow extends RowDataPacket {
	next_lookup_id: number;
	next_seq: number;
}

const defaultCsvImportPath = path.resolve(__dirname, '..', '..', 'client', 'src', 'assets', 'NRC Repairs Log - Repairs.csv');
const configuredCsvImportPath = process.env.REPAIRS_CSV_IMPORT_PATH;
const csvImportPath = configuredCsvImportPath
	? path.isAbsolute(configuredCsvImportPath)
		? configuredCsvImportPath
		: path.resolve(__dirname, '..', '..', configuredCsvImportPath)
	: defaultCsvImportPath;

const parseIntParam = (value: string | undefined, fallback?: number): number | undefined => {
	if (value === undefined) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
};

const parseCsvBoolean = (value: string): number => {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y') {
		return 1;
	}

	return 0;
};

const parseCsvDate = (value: string): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const dmyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (dmyMatch) {
		const [, day, month, year] = dmyMatch;
		return `${year}-${month}-${day}`;
	}

	const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (ymdMatch) {
		const [, year, month, day] = ymdMatch;
		return `${year}-${month}-${day}`;
	}

	return null;
};

const normalizeLookupName = (value: string): string => value.trim();

app.get('/api/health', async (_req, res) => {
	try {
		await pool.query('SELECT 1');
		res.json({ ok: true });
	} catch {
		res.status(500).json({ ok: false });
	}
});

app.get('/api/lookups/:group', async (req, res, next) => {
	const group = req.params.group as LookupGroup;
	const allowedGroups: LookupGroup[] = ['source', 'venue', 'section', 'repairer'];

	if (!allowedGroups.includes(group)) {
		res.status(400).json({ message: 'Invalid lookup group. Use source, venue, section, or repairer.' });
		return;
	}

	try {
		const [rows] = await pool.query<LookupRow[]>(
			`
			SELECT lookup_id, lk_group, lk_name, lk_seq, lk_header
			FROM lookup
			WHERE lk_group = ?
				AND COALESCE(lk_header, 0) = 0
			ORDER BY lk_header DESC, lk_seq ASC, lk_name ASC
			`,
			[group],
		);

		res.json(rows);
	} catch (error) {
		next(error);
	}
});

const parseRepairPayload = (body: unknown): RepairPayload | null => {
	if (!body || typeof body !== 'object') {
		return null;
	}

	const raw = body as Record<string, unknown>;

	const rp_uid = Number(raw.rp_uid ?? 0);
	const rp_event = Number(raw.rp_event);
	const rp_section = Number(raw.rp_section);
	const rp_source = raw.rp_source === '' || raw.rp_source === undefined ? 0 : Number(raw.rp_source);
	const rp_repairer = raw.rp_repairer === '' || raw.rp_repairer === undefined ? 0 : Number(raw.rp_repairer);
	const rp_tryfix = Number(raw.rp_tryfix);
	const rp_fixed = Number(raw.rp_fixed);
	const rp_item = String(raw.rp_item ?? '').trim();
	const rp_problem = String(raw.rp_problem ?? '').trim();
	const rp_comments = String(raw.rp_comments ?? '').trim();

	const hasInvalidNumber =
		(raw.rp_uid !== undefined && !Number.isInteger(rp_uid)) ||
		(raw.rp_source !== undefined && raw.rp_source !== '' && !Number.isInteger(rp_source)) ||
		(raw.rp_repairer !== undefined && raw.rp_repairer !== '' && !Number.isInteger(rp_repairer)) ||
		![rp_event, rp_section, rp_tryfix, rp_fixed].every((value) => Number.isInteger(value));

	if (hasInvalidNumber || !rp_item) {
		return null;
	}

	return {
		rp_uid,
		rp_event,
		rp_item,
		rp_problem,
		rp_section,
		rp_source,
		rp_repairer,
		rp_tryfix: rp_tryfix ? 1 : 0,
		rp_fixed: rp_fixed ? 1 : 0,
		rp_comments,
	};
};

const selectRepairById = async (repairId: number): Promise<RepairRow | null> => {
	const [rows] = await pool.query<RepairRow[]>(
		`
		SELECT
			r.repair_id,
			r.rp_uid,
			r.rp_event,
			r.rp_item,
			r.rp_problem,
			r.rp_section,
			r.rp_source,
			r.rp_repairer,
			r.rp_tryfix,
			r.rp_fixed,
			r.rp_comments,
			e.ev_date AS event_date,
			e.ev_comment AS event_comment,
			e.ev_venue AS venue_id,
			venue.lk_name AS venue_name,
			section.lk_name AS section_name,
			source.lk_name AS source_name,
			repairer.lk_name AS repairer_name
		FROM repair r
		INNER JOIN event e
			ON e.event_id = r.rp_event
		LEFT JOIN lookup source
			ON source.lookup_id = r.rp_source
		 AND source.lk_group = 'source'
		LEFT JOIN lookup section
			ON section.lookup_id = r.rp_section
		 AND section.lk_group = 'section'
		LEFT JOIN lookup venue
			ON venue.lookup_id = e.ev_venue
		 AND venue.lk_group = 'venue'
		LEFT JOIN lookup repairer
			ON repairer.lookup_id = r.rp_repairer
		 AND repairer.lk_group = 'repairer'
		WHERE r.repair_id = ?
		LIMIT 1
		`,
		[repairId],
	);

	return rows[0] ?? null;
};

app.get('/api/events', async (req, res, next) => {
	const venueId = parseIntParam(req.query.venueId as string | undefined);
	const fromDate = (req.query.fromDate as string | undefined) ?? null;
	const toDate = (req.query.toDate as string | undefined) ?? null;

	if (req.query.venueId && venueId === undefined) {
		res.status(400).json({ message: 'venueId must be a number.' });
		return;
	}

	try {
		const [rows] = await pool.query<EventRow[]>(
			`
			SELECT e.event_id, e.ev_date, e.ev_venue, e.ev_comment, v.lk_name AS venue_name
			FROM event e
			LEFT JOIN lookup v
				ON v.lookup_id = e.ev_venue
			 AND v.lk_group = 'venue'
			WHERE (? IS NULL OR e.ev_venue = ?)
				AND (? IS NULL OR e.ev_date >= ?)
				AND (? IS NULL OR e.ev_date <= ?)
			ORDER BY e.ev_date DESC, e.event_id DESC
			`,
			[venueId ?? null, venueId ?? null, fromDate, fromDate, toDate, toDate],
		);

		res.json(rows);
	} catch (error) {
		next(error);
	}
});

app.get('/api/repairs', async (req, res, next) => {
	const eventId = parseIntParam(req.query.eventId as string | undefined);
	const fixed = parseIntParam(req.query.fixed as string | undefined);
	const tryfix = parseIntParam(req.query.tryfix as string | undefined);
	const sourceId = parseIntParam(req.query.sourceId as string | undefined);
	const sectionId = parseIntParam(req.query.sectionId as string | undefined);
	const limit = parseIntParam(req.query.limit as string | undefined, 100) ?? 100;

	const hasInvalidNumberParam =
		(req.query.eventId && eventId === undefined) ||
		(req.query.fixed && fixed === undefined) ||
		(req.query.tryfix && tryfix === undefined) ||
		(req.query.sourceId && sourceId === undefined) ||
		(req.query.sectionId && sectionId === undefined) ||
		(req.query.limit && !Number.isFinite(limit));

	if (hasInvalidNumberParam) {
		res.status(400).json({ message: 'One or more numeric query params are invalid.' });
		return;
	}

	try {
		const [rows] = await pool.query<RepairRow[]>(
			`
			SELECT
				r.repair_id,
				r.rp_uid,
				r.rp_event,
				r.rp_item,
				r.rp_problem,
				r.rp_section,
				r.rp_source,
				r.rp_repairer,
				r.rp_tryfix,
				r.rp_fixed,
				r.rp_comments,
				e.ev_date AS event_date,
				e.ev_comment AS event_comment,
				e.ev_venue AS venue_id,
				venue.lk_name AS venue_name,
				section.lk_name AS section_name,
				source.lk_name AS source_name,
				repairer.lk_name AS repairer_name
			FROM repair r
			INNER JOIN event e
				ON e.event_id = r.rp_event
			LEFT JOIN lookup source
				ON source.lookup_id = r.rp_source
			 AND source.lk_group = 'source'
			LEFT JOIN lookup section
				ON section.lookup_id = r.rp_section
			 AND section.lk_group = 'section'
			LEFT JOIN lookup venue
				ON venue.lookup_id = e.ev_venue
			 AND venue.lk_group = 'venue'
			LEFT JOIN lookup repairer
				ON repairer.lookup_id = r.rp_repairer
			 AND repairer.lk_group = 'repairer'
			WHERE (? IS NULL OR r.rp_event = ?)
				AND (? IS NULL OR r.rp_fixed = ?)
				AND (? IS NULL OR r.rp_tryfix = ?)
				AND (? IS NULL OR r.rp_source = ?)
				AND (? IS NULL OR r.rp_section = ?)
			ORDER BY e.ev_date DESC, r.repair_id DESC
			LIMIT ?
			`,
			[
				eventId ?? null,
				eventId ?? null,
				fixed ?? null,
				fixed ?? null,
				tryfix ?? null,
				tryfix ?? null,
				sourceId ?? null,
				sourceId ?? null,
				sectionId ?? null,
				sectionId ?? null,
				Math.max(1, Math.min(limit, 1000)),
			],
		);

		res.json(rows);
	} catch (error) {
		next(error);
	}
});

app.get('/api/repairs/max-uid', async (_req, res, next) => {
	try {
		const [rows] = await pool.query<MaxUidRow[]>('SELECT MAX(rp_uid) AS max_uid FROM repair');
		res.json({ maxUid: rows[0]?.max_uid ?? 0 });
	} catch (error) {
		next(error);
	}
});

app.post('/api/import/repairs-csv', async (_req, res, next) => {
	try {
		const csvContent = await fs.readFile(csvImportPath, 'utf8');
		const csvRows = parse(csvContent, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as CsvRepairRow[];

		const [eventRows] = await pool.query<EventDateRow[]>('SELECT event_id, ev_date FROM event ORDER BY event_id DESC');
		const eventIdByDate = new Map<string, number>();
		for (const row of eventRows) {
			if (!eventIdByDate.has(row.ev_date)) {
				eventIdByDate.set(row.ev_date, row.event_id);
			}
		}

		const [uidRows] = await pool.query<RowDataPacket[]>('SELECT rp_uid FROM repair');
		const existingUids = new Set<number>(uidRows.map((row) => Number(row.rp_uid)).filter((value) => Number.isInteger(value)));

		const [lookupRows] = await pool.query<LookupRow[]>(
			`
			SELECT lookup_id, lk_group, lk_name, lk_seq, lk_header
			FROM lookup
			WHERE lk_group IN ('source', 'section')
				AND COALESCE(lk_header, 0) = 0
			`,
		);

		const sourceLookup = new Map<string, number>();
		const sectionLookup = new Map<string, number>();
		for (const row of lookupRows) {
			if (row.lk_group === 'source') {
				sourceLookup.set(row.lk_name.toLowerCase(), row.lookup_id);
			}
			if (row.lk_group === 'section') {
				sectionLookup.set(row.lk_name.toLowerCase(), row.lookup_id);
			}
		}

		const ensureLookupId = async (group: 'source' | 'section', rawName: string): Promise<number> => {
			const normalizedName = normalizeLookupName(rawName);
			if (!normalizedName) {
				return 0;
			}

			const key = normalizedName.toLowerCase();
			const map = group === 'source' ? sourceLookup : sectionLookup;
			const existingId = map.get(key);
			if (existingId !== undefined) {
				return existingId;
			}

			const [nextRows] = await pool.query<LookupCreateRow[]>(
				`
				SELECT
					COALESCE(MAX(lookup_id), 0) + 1 AS next_lookup_id,
					COALESCE(MAX(CASE WHEN lk_group = ? THEN lk_seq END), 0) + 1 AS next_seq
				FROM lookup
				`,
				[group],
			);

			const nextLookupId = nextRows[0]?.next_lookup_id ?? 1;
			const nextSeq = nextRows[0]?.next_seq ?? 1;

			await pool.execute(
				'INSERT INTO lookup (lookup_id, lk_group, lk_name, lk_seq, lk_header) VALUES (?, ?, ?, ?, 0)',
				[nextLookupId, group, normalizedName, nextSeq],
			);

			map.set(key, nextLookupId);
			return nextLookupId;
		};

		let inserted = 0;
		let skippedExisting = 0;
		let skippedInvalid = 0;
		let createdSourceLookups = 0;
		let createdSectionLookups = 0;
		const errors: string[] = [];

		for (const row of csvRows) {
			const uid = Number.parseInt(String(row.rp_uid ?? '').trim(), 10);
			if (!Number.isInteger(uid)) {
				skippedInvalid += 1;
				errors.push(`Invalid rp_uid: ${row.rp_uid}`);
				continue;
			}

			if (existingUids.has(uid)) {
				skippedExisting += 1;
				continue;
			}

			const eventDate = parseCsvDate(String(row.rp_event ?? ''));
			const eventId = eventDate ? eventIdByDate.get(eventDate) : undefined;

			if (!eventId) {
				skippedInvalid += 1;
				errors.push(`No matching event for date: ${row.rp_event}`);
				continue;
			}

			const rpItem = String(row.rp_item ?? '').trim();
			if (!rpItem) {
				skippedInvalid += 1;
				errors.push(`Missing rp_item for rp_uid: ${uid}`);
				continue;
			}

			const sourceName = String(row.rp_source ?? '');
			const sectionName = String(row.rp_section ?? '');
			const sourceKey = normalizeLookupName(sourceName).toLowerCase();
			const sectionKey = normalizeLookupName(sectionName).toLowerCase();

			const hadSourceLookup = sourceKey ? sourceLookup.has(sourceKey) : true;
			const hadSectionLookup = sectionKey ? sectionLookup.has(sectionKey) : true;

			const sourceId = await ensureLookupId('source', sourceName);
			const sectionId = await ensureLookupId('section', sectionName);

			if (!hadSourceLookup && sourceKey) {
				createdSourceLookups += 1;
			}
			if (!hadSectionLookup && sectionKey) {
				createdSectionLookups += 1;
			}

			await pool.execute(
				`
				INSERT INTO repair
					(rp_uid, rp_event, rp_item, rp_problem, rp_section, rp_source, rp_repairer, rp_tryfix, rp_fixed, rp_comments)
				VALUES
					(?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
				`,
				[
					uid,
					eventId,
					rpItem,
					String(row.rp_problem ?? '').trim(),
					sectionId,
					sourceId,
					parseCsvBoolean(String(row.rp_tryfix ?? '')),
					parseCsvBoolean(String(row.rp_fixed ?? '')),
					String(row.rp_comment ?? '').trim(),
				],
			);

			existingUids.add(uid);
			inserted += 1;
		}

		res.json({
			file: csvImportPath,
			totalRows: csvRows.length,
			inserted,
			skippedExisting,
			skippedInvalid,
			createdLookups: {
				source: createdSourceLookups,
				section: createdSectionLookups,
			},
			errors: errors.slice(0, 25),
		});
	} catch (error) {
		next(error);
	}
});

app.get('/api/repairs/:id', async (req, res, next) => {
	const id = parseIntParam(req.params.id);

	if (id === undefined) {
		res.status(400).json({ message: 'Repair id must be a number.' });
		return;
	}

	try {
		const row = await selectRepairById(id);

		if (!row) {
			res.status(404).json({ message: 'Repair not found.' });
			return;
		}

		res.json(row);
	} catch (error) {
		next(error);
	}
});

app.post('/api/repairs', async (req, res, next) => {
	const payload = parseRepairPayload(req.body);

	if (!payload) {
		res.status(400).json({ message: 'Invalid repair payload.' });
		return;
	}

	try {
		const [maxUidRows] = await pool.query<MaxUidRow[]>('SELECT MAX(rp_uid) AS max_uid FROM repair');
		const nextRpUid = (maxUidRows[0]?.max_uid ?? 0) + 1;

		const [result] = await pool.execute<ResultSetHeader>(
			`
			INSERT INTO repair
				(rp_uid, rp_event, rp_item, rp_problem, rp_section, rp_source, rp_repairer, rp_tryfix, rp_fixed, rp_comments)
			VALUES
				(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			[
				nextRpUid,
				payload.rp_event,
				payload.rp_item,
				payload.rp_problem,
				payload.rp_section,
				payload.rp_source,
				payload.rp_repairer,
				payload.rp_tryfix,
				payload.rp_fixed,
				payload.rp_comments,
			],
		);

		const row = await selectRepairById(result.insertId);
		res.status(201).json(row);
	} catch (error) {
		next(error);
	}
});

app.put('/api/repairs/:id', async (req, res, next) => {
	const id = parseIntParam(req.params.id);
	const payload = parseRepairPayload(req.body);

	if (id === undefined || !payload) {
		res.status(400).json({ message: 'Invalid request.' });
		return;
	}

	try {
		const [result] = await pool.execute<ResultSetHeader>(
			`
			UPDATE repair
			SET
				rp_uid = ?,
				rp_event = ?,
				rp_item = ?,
				rp_problem = ?,
				rp_section = ?,
				rp_source = ?,
				rp_repairer = ?,
				rp_tryfix = ?,
				rp_fixed = ?,
				rp_comments = ?
			WHERE repair_id = ?
			`,
			[
				payload.rp_uid,
				payload.rp_event,
				payload.rp_item,
				payload.rp_problem,
				payload.rp_section,
				payload.rp_source,
				payload.rp_repairer,
				payload.rp_tryfix,
				payload.rp_fixed,
				payload.rp_comments,
				id,
			],
		);

		if (result.affectedRows === 0) {
			res.status(404).json({ message: 'Repair not found.' });
			return;
		}

		const row = await selectRepairById(id);
		res.json(row);
	} catch (error) {
		next(error);
	}
});

app.delete('/api/repairs/:id', async (req, res, next) => {
	const id = parseIntParam(req.params.id);

	if (id === undefined) {
		res.status(400).json({ message: 'Repair id must be a number.' });
		return;
	}

	try {
		const [result] = await pool.execute<ResultSetHeader>('DELETE FROM repair WHERE repair_id = ? LIMIT 1', [id]);

		if (result.affectedRows === 0) {
			res.status(404).json({ message: 'Repair not found.' });
			return;
		}

		res.status(204).send();
	} catch (error) {
		next(error);
	}
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
	console.error(error);
	res.status(500).json({ message: 'Internal server error' });
});

app.listen(port, () => {
	console.log(`API listening on port ${port}`);
});
