"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePage = parsePage;
exports.pageInfo = pageInfo;
function parsePage(query, defaultSize = 20) {
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? '1'), 10) || 1));
    const size = Number.parseInt(String(query.size ?? defaultSize), 10) || defaultSize;
    return { page, pageSize: Math.max(5, Math.min(100, size)) };
}
function pageInfo(params, total) {
    return { ...params, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
