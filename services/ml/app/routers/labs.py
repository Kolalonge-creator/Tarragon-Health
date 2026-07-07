"""Lab/screening result interpretation endpoint (Sprint 4, week 8).

Feeds `AbnormalResultHandler`: the response shape mirrors the
`screening_results` table columns 1:1 (`result_status`, `abnormal_flags`,
`summary` -> `result_summary`) so the caller can insert it directly.
"""

from fastapi import APIRouter, Depends

from ..schemas.labs import AnalyteResultOut, LabInterpretationRequest, LabInterpretationResponse
from ..scoring.screening_interpretation import AnalyteReading, interpret_screening_result
from ..security import require_service_key

router = APIRouter(prefix="/interpret", tags=["labs"], dependencies=[Depends(require_service_key)])


@router.post("/labs", response_model=LabInterpretationResponse)
async def interpret_labs(payload: LabInterpretationRequest) -> LabInterpretationResponse:
    result = interpret_screening_result(
        screen_type_code=payload.screen_type_code,
        sex=payload.sex,
        age=payload.age,
        analytes=[
            AnalyteReading(code=a.code, value=a.value, hba1c_unit=a.hba1c_unit)
            for a in payload.analytes
        ],
        qualitative_result=payload.qualitative_result,
        genotype=payload.genotype,
        procedural_status=payload.procedural_status,
    )
    return LabInterpretationResponse(
        result_status=result.result_status,
        abnormal_flags=result.abnormal_flags,
        analyte_results=[
            AnalyteResultOut(
                code=r.code,
                value=r.value,
                status=r.status,
                reference_range=r.reference_range,
                flag=r.flag,
                value_percent=r.value_percent,
                value_mmol_mol=r.value_mmol_mol,
            )
            for r in result.analyte_results
        ],
        summary=result.summary,
    )
