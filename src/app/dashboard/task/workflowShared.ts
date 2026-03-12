export type ProductionRoleKey = "lead_welder" | "helper_welder" | "sealant_applicator" | "repair_staff";

export type ProductionStageKey =
	| "material_preparation"
	| "frame_fabrication_welding"
	| "glass_installation"
	| "sealant_application"
	| "quality_checking";

export type WorkflowMember = {
	admin_id: string;
	admin_name: string;
	employee_number?: string | null;
	position?: string | null;
	role_keys: ProductionRoleKey[];
	role_labels: string[];
};

export type WorkflowTaskMeta = {
	task_id: number;
	assigned_admin_id: string;
	employee_name: string;
	employee_number?: string | null;
	role_key: ProductionRoleKey;
	role_label: string;
	stage_key: ProductionStageKey;
	stage_label: string;
	due_date?: string | null;
};

export type WorkflowStageMeta = {
	key: ProductionStageKey;
	label: string;
	order: number;
	required_role_keys: ProductionRoleKey[];
	assigned_admin_ids: string[];
	task_ids: number[];
	approved_task_ids: number[];
	approved_update_ids: string[];
	last_submission_at?: string | null;
	approved_at?: string | null;
	status: "pending" | "in_progress" | "approved";
};

export type ProductionWorkflowMeta = {
	version: number;
	estimated_completion_date?: string | null;
	final_product_images: string[];
	final_product_note?: string | null;
	final_product_update_id?: string | null;
	last_updated_at?: string | null;
	started_at?: string | null;
	team_members: WorkflowMember[];
	stage_plans: WorkflowStageMeta[];
	task_registry: WorkflowTaskMeta[];
};

type RoleConfig = {
	key: ProductionRoleKey;
	label: string;
	aliases: string[];
};

type StageConfig = {
	key: ProductionStageKey;
	label: string;
	order: number;
	roleKeys: ProductionRoleKey[];
};

export const PRODUCTION_ROLE_CONFIGS: RoleConfig[] = [
	{
		key: "lead_welder",
		label: "Lead Welder",
		aliases: ["lead welder", "lead_welder", "welder lead", "team leader welder"],
	},
	{
		key: "helper_welder",
		label: "Helper Welder",
		aliases: ["helper welder", "helper_welder", "welder helper"],
	},
	{
		key: "sealant_applicator",
		label: "Sealant Applicator",
		aliases: ["sealant applicator", "sealant_applicator", "sealant"],
	},
	{
		key: "repair_staff",
		label: "Repair Staff",
		aliases: ["repair staff", "repair_staff", "repair", "glass installer", "installation staff"],
	},
];

export const PRODUCTION_STAGES: StageConfig[] = [
	{
		key: "material_preparation",
		label: "Material Preparation Stage",
		order: 1,
		roleKeys: ["lead_welder", "helper_welder", "repair_staff"],
	},
	{
		key: "frame_fabrication_welding",
		label: "Frame Fabrication & Welding",
		order: 2,
		roleKeys: ["lead_welder", "helper_welder"],
	},
	{
		key: "glass_installation",
		label: "Glass Installation",
		order: 3,
		roleKeys: ["sealant_applicator"],
	},
	{
		key: "sealant_application",
		label: "Sealant Application",
		order: 4,
		roleKeys: ["sealant_applicator"],
	},
	{
		key: "quality_checking",
		label: "Quality Checking",
		order: 5,
		roleKeys: ["repair_staff"],
	},
];

export const FINAL_PRODUCTION_STAGE_KEY = PRODUCTION_STAGES[PRODUCTION_STAGES.length - 1]!
	.key as ProductionStageKey;

export const PRODUCTION_ROLE_LABELS = Object.fromEntries(
	PRODUCTION_ROLE_CONFIGS.map((role) => [role.key, role.label])
) as Record<ProductionRoleKey, string>;

export const PRODUCTION_STAGE_LABELS = Object.fromEntries(
	PRODUCTION_STAGES.map((stage) => [stage.key, stage.label])
) as Record<ProductionStageKey, string>;

export const PRODUCTION_STAGE_ROLE_MAP = Object.fromEntries(
	PRODUCTION_STAGES.map((stage) => [stage.key, stage.roleKeys])
) as Record<ProductionStageKey, ProductionRoleKey[]>;

export function clampPercent(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, Math.round(value)));
}

export function getRoleConfig(key: ProductionRoleKey) {
	return PRODUCTION_ROLE_CONFIGS.find((role) => role.key === key) || PRODUCTION_ROLE_CONFIGS[0];
}

export function getStageConfig(key: ProductionStageKey) {
	return PRODUCTION_STAGES.find((stage) => stage.key === key) || PRODUCTION_STAGES[0];
}

export function getProductionRoleKeyFromText(value: string | null | undefined): ProductionRoleKey | null {
	const raw = String(value || "").trim().toLowerCase();
	if (!raw) return null;

	for (const role of PRODUCTION_ROLE_CONFIGS) {
		if (role.aliases.some((alias) => raw.includes(alias))) {
			return role.key;
		}
	}

	return null;
}

export function getProductionRoleForAdmin(admin: { role?: string | null; position?: string | null }) {
	return getProductionRoleKeyFromText(admin.position) || null;
}

export function getProductionRoleLabelForAdmin(admin: { role?: string | null; position?: string | null }) {
	const key = getProductionRoleForAdmin(admin);
	return key ? PRODUCTION_ROLE_LABELS[key] : null;
}

export function canManageProductionWorkflow(admin: { role?: string | null; position?: string | null } | null | undefined) {
	const role = String(admin?.role || "")
		.trim()
		.toLowerCase();
	const position = String(admin?.position || "")
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, " ");

	if (["superadmin", "admin", "manager", "supervisor"].includes(role)) {
		return true;
	}

	return (
		position.includes("team leader") ||
		position.includes("production manager") ||
		position.includes("production supervisor")
	);
}

export function ensureProductionWorkflow(raw: unknown): ProductionWorkflowMeta {
	const input = raw && typeof raw === "object" ? (raw as Partial<ProductionWorkflowMeta>) : {};
	const stageMap = new Map<string, WorkflowStageMeta>();

	for (const stage of PRODUCTION_STAGES) {
		stageMap.set(stage.key, {
			key: stage.key,
			label: stage.label,
			order: stage.order,
			required_role_keys: [...stage.roleKeys],
			assigned_admin_ids: [],
			task_ids: [],
			approved_task_ids: [],
			approved_update_ids: [],
			last_submission_at: null,
			approved_at: null,
			status: "pending",
		});
	}

	if (Array.isArray(input.stage_plans)) {
		for (const stage of input.stage_plans) {
			if (!stage || typeof stage !== "object") continue;
			const key = String((stage as WorkflowStageMeta).key || "") as ProductionStageKey;
			if (!stageMap.has(key)) continue;
			const base = stageMap.get(key)!;
			stageMap.set(key, {
				...base,
				...(stage as WorkflowStageMeta),
				label: PRODUCTION_STAGE_LABELS[key],
				order: getStageConfig(key).order,
				required_role_keys: [...getStageConfig(key).roleKeys],
				assigned_admin_ids: Array.isArray((stage as WorkflowStageMeta).assigned_admin_ids)
					? Array.from(new Set((stage as WorkflowStageMeta).assigned_admin_ids.filter(Boolean)))
					: [],
				task_ids: Array.isArray((stage as WorkflowStageMeta).task_ids)
					? Array.from(new Set((stage as WorkflowStageMeta).task_ids.map((value) => Number(value)).filter(Number.isFinite)))
					: [],
				approved_task_ids: Array.isArray((stage as WorkflowStageMeta).approved_task_ids)
					? Array.from(
							new Set((stage as WorkflowStageMeta).approved_task_ids.map((value) => Number(value)).filter(Number.isFinite))
						)
					: [],
				approved_update_ids: Array.isArray((stage as WorkflowStageMeta).approved_update_ids)
					? Array.from(new Set((stage as WorkflowStageMeta).approved_update_ids.filter(Boolean)))
					: [],
			});
		}
	}

	const taskRegistry = Array.isArray(input.task_registry)
		? (input.task_registry.filter(Boolean) as WorkflowTaskMeta[])
				.map((task) => ({
					...task,
					role_label: PRODUCTION_ROLE_LABELS[task.role_key] || task.role_label,
					stage_label: PRODUCTION_STAGE_LABELS[task.stage_key] || task.stage_label,
				}))
				.filter((task) => Number.isFinite(Number(task.task_id)))
		: [];

	const teamMembers = Array.isArray(input.team_members)
		? (input.team_members.filter(Boolean) as WorkflowMember[]).map((member) => ({
				...member,
				role_keys: Array.isArray(member.role_keys)
					? member.role_keys.filter(Boolean)
					: [],
				role_labels: Array.isArray(member.role_keys)
					? member.role_keys.map((key) => PRODUCTION_ROLE_LABELS[key] || key)
					: Array.isArray(member.role_labels)
						? member.role_labels
						: [],
			}))
		: [];

	return {
		version: 1,
		estimated_completion_date: input.estimated_completion_date || null,
		final_product_images: Array.isArray(input.final_product_images)
			? input.final_product_images.filter(Boolean)
			: [],
		final_product_note: input.final_product_note || null,
		final_product_update_id: input.final_product_update_id || null,
		started_at: input.started_at || null,
		last_updated_at: input.last_updated_at || null,
		team_members: teamMembers,
		task_registry: taskRegistry,
		stage_plans: PRODUCTION_STAGES.map((stage) => {
			const plan = stageMap.get(stage.key)!;
			const computedStatus =
				plan.task_ids.length > 0 && plan.approved_task_ids.length >= plan.task_ids.length
					? "approved"
					: plan.approved_task_ids.length > 0 || plan.last_submission_at
						? "in_progress"
						: "pending";
			const status = ((): WorkflowStageMeta["status"] => {
				const stored = (plan as any)?.status;
				if (stored === "pending" || stored === "in_progress" || stored === "approved") return stored;
				return computedStatus;
			})();
			return {
				...plan,
				status,
			};
		}),
	};
}

export function buildWorkflowMembers<T extends { id: string; full_name?: string | null; username?: string | null; employee_number?: string | null; position?: string | null }>(
	employees: T[],
	roleAssignments: Record<ProductionRoleKey, string[]>
): WorkflowMember[] {
	const memberMap = new Map<string, WorkflowMember>();

	for (const role of PRODUCTION_ROLE_CONFIGS) {
		for (const adminId of roleAssignments[role.key] || []) {
			const employee = employees.find((item) => item.id === adminId);
			if (!employee) continue;
			const existing = memberMap.get(adminId);
			if (existing) {
				if (!existing.role_keys.includes(role.key)) {
					existing.role_keys.push(role.key);
					existing.role_labels.push(role.label);
				}
				continue;
			}

			memberMap.set(adminId, {
				admin_id: adminId,
				admin_name: employee.full_name || employee.username || "Unknown Employee",
				employee_number: employee.employee_number || null,
				position: employee.position || null,
				role_keys: [role.key],
				role_labels: [role.label],
			});
		}
	}

	return Array.from(memberMap.values()).sort((a, b) => a.admin_name.localeCompare(b.admin_name));
}

export function buildStagePlansFromAssignments(roleAssignments: Record<ProductionRoleKey, string[]>) {
	return PRODUCTION_STAGES.map((stage) => {
		const assigned = stage.roleKeys.flatMap((roleKey) => roleAssignments[roleKey] || []);
		const uniqueAssigned = Array.from(new Set(assigned.filter(Boolean)));
		return {
			key: stage.key,
			label: stage.label,
			order: stage.order,
			required_role_keys: [...stage.roleKeys],
			assigned_admin_ids: uniqueAssigned,
			task_ids: [],
			approved_task_ids: [],
			approved_update_ids: [],
			last_submission_at: null,
			approved_at: null,
			status: uniqueAssigned.length ? "pending" : "pending",
		} as WorkflowStageMeta;
	});
}

export function getTaskMetaById(workflow: ProductionWorkflowMeta | null | undefined, taskId: number) {
	if (!workflow) return null;
	return workflow.task_registry.find((task) => Number(task.task_id) === Number(taskId)) || null;
}

export function getStageMetaByKey(workflow: ProductionWorkflowMeta | null | undefined, stageKey: ProductionStageKey) {
	if (!workflow) return null;
	return workflow.stage_plans.find((stage) => stage.key === stageKey) || null;
}

export function createEmptyRoleAssignments(): Record<ProductionRoleKey, string[]> {
	return {
		lead_welder: [],
		helper_welder: [],
		sealant_applicator: [],
		repair_staff: [],
	};
}

export function buildRoleAssignmentsFromWorkflow(workflow: ProductionWorkflowMeta | null | undefined) {
	const next = createEmptyRoleAssignments();
	if (!workflow) return next;

	for (const member of workflow.team_members) {
		for (const roleKey of member.role_keys || []) {
			if (!next[roleKey].includes(member.admin_id)) {
				next[roleKey].push(member.admin_id);
			}
		}
	}

	return next;
}
