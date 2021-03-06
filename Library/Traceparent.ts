import Util = require("./Util");
import CorrelationIdManager = require("./CorrelationIdManager");

/**
 * Helper class to manage parsing and validation of traceparent header. Also handles hierarchical
 * back-compatibility headers generated from traceparent. W3C traceparent spec is documented at
 * https://www.w3.org/TR/trace-context/#traceparent-field
 */
class Traceparent {
    public static DEFAULT_TRACE_FLAG = "01";
    public static DEFAULT_VERSION = "00";

    public legacyRootId: string;
    public parentId: string;
    public spanId: string;
    public traceFlag: string = Traceparent.DEFAULT_TRACE_FLAG;
    public traceId: string;
    public version: string = Traceparent.DEFAULT_VERSION;

    constructor(traceparent?: string, parentId?: string) {
        if (traceparent && typeof traceparent === "string") { // traceparent constructor
            // If incoming request contains traceparent: parse it, set operation, parent and telemetry id accordingly. traceparent should be injected into outgoing requests. request-id should be injected in back-compat format |traceId.spanId. so that older SDKs could understand it.
            if (traceparent.split(",").length > 1) { // If more than 1 traceparent is present, discard both
                this.traceId = Util.w3cTraceId();
                this.spanId = Util.w3cTraceId().substr(0, 16);
            } else {
                const traceparentArr = traceparent.trim().split("-");
                const len = traceparentArr.length;
                if (len >= 4) { // traceparent must contain at least 4 fields
                    this.version = traceparentArr[0];
                    this.traceId = traceparentArr[1];
                    this.spanId = traceparentArr[2];
                    this.traceFlag = traceparentArr[3];
                } else { // Discard traceparent if a field is missing
                    this.traceId = Util.w3cTraceId();
                    this.spanId = Util.w3cTraceId().substr(0, 16);
                }

                // Version validation
                if (!this.version.match(/^[0-9a-f]{2}$/g)) {
                    this.version = Traceparent.DEFAULT_VERSION;
                    this.traceId = Util.w3cTraceId();
                }
                if (this.version === "00" && len !== 4) { // 0x00 (and perhaps future versions) require exactly 4 fields. This strict check will need to be updated on each spec release
                    this.traceId = Util.w3cTraceId();
                    this.spanId = Util.w3cTraceId().substr(0, 16);
                }
                if (this.version === "ff") { // 0xff is forbidden, generate new traceparent
                    this.version = Traceparent.DEFAULT_VERSION;
                    this.traceId = Util.w3cTraceId();
                    this.spanId = Util.w3cTraceId().substr(0, 16);
                }
                if (!this.version.match(/^0[0-9a-f]$/g)) {
                    this.version = Traceparent.DEFAULT_VERSION;
                }

                // TraceFlag validation
                if (!this.traceFlag.match(/^[0-9a-f]{2}$/g)) {
                    this.traceFlag = Traceparent.DEFAULT_TRACE_FLAG;
                    this.traceId = Util.w3cTraceId();
                }

                // Validate TraceId, regenerate new traceid if invalid
                if (!Traceparent.isValidTraceId(this.traceId)) {
                    this.traceId = Util.w3cTraceId();
                }

                // Validate Span Id, discard entire traceparent if invalid
                if (!Traceparent.isValidSpanId(this.spanId)) {
                    this.spanId = Util.w3cTraceId().substr(0, 16);
                    this.traceId = Util.w3cTraceId();
                }

                // Save backCompat parentId
                this.parentId = this.getBackCompatRequestId();
            }
        } else if (parentId) { // backcompat constructor
            // If incoming request contains only request-id, new traceid and spanid should be started, request-id value should be used as a parent. Root part of request-id should be stored in custom dimension on the request telemetry if root part is different from traceid. On the outgoing request side, request-id should be emitted in the |traceId.spanId. format.
            this.parentId = parentId.slice(); // copy
            let operationId = CorrelationIdManager.getRootId(parentId);
            if (!Traceparent.isValidTraceId(operationId)) {
                this.legacyRootId = operationId;
                operationId = Util.w3cTraceId();
            }
            if (parentId.indexOf("|") !== -1) {
                parentId = parentId.substring(1 + parentId.substring(0, parentId.length - 1).lastIndexOf("."), parentId.length - 1);
            }
            this.traceId = operationId;
            this.spanId = parentId;
        } else {
            // Fallback default constructor
            // if request does not contain any correlation headers, see case p2
            this.traceId = Util.w3cTraceId();
            this.spanId = Util.w3cTraceId().substr(0, 16);
        }

    }

    public static isValidTraceId(id: string): boolean {
        return id.match(/^[0-9a-f]{32}$/) && id !== "00000000000000000000000000000000";
    }

    public static isValidSpanId(id: string): boolean {
        return id.match(/^[0-9a-f]{16}$/) && id !== "0000000000000000";
    }

    public getBackCompatRequestId(): string {
        return `|${this.traceId}.${this.spanId}.`;
    }

    public toString(): string {
        return `${this.version}-${this.traceId}-${this.spanId}-${this.traceFlag}`;
    }

    public updateSpanId(): void {
        this.spanId = Util.w3cTraceId().substr(0, 16);
    }
}

export = Traceparent;
