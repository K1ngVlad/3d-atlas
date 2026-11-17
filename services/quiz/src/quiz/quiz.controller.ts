import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { QuizService } from './quiz.service';

const CLIENT_HEADER = 'x-client-id';

/** HTTP API from contracts.md, "Quiz Service". Validation and rules live in QuizService. */
@Controller('api/quiz')
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Get('quizzes')
  list() {
    return this.quiz.listQuizzes();
  }

  @Get('quizzes/:id')
  get(@Param('id') id: string) {
    return this.quiz.getQuiz(id);
  }

  @Post('attempts')
  start(@Body() body: unknown) {
    return this.quiz.startAttempt(body);
  }

  @Get('attempts/:attemptId')
  attempt(@Param('attemptId') attemptId: string, @Headers(CLIENT_HEADER) clientId?: string) {
    return this.quiz.getAttempt(attemptId, clientId);
  }

  @Post('attempts/:attemptId/answers')
  @HttpCode(200)
  answer(@Param('attemptId') attemptId: string, @Headers(CLIENT_HEADER) clientId: string | undefined, @Body() body: unknown) {
    return this.quiz.answer(attemptId, clientId, body);
  }

  @Post('attempts/:attemptId/complete')
  @HttpCode(200)
  complete(@Param('attemptId') attemptId: string, @Headers(CLIENT_HEADER) clientId?: string) {
    return this.quiz.complete(attemptId, clientId);
  }
}
