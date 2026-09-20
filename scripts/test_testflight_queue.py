import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('queue', Path(__file__).with_name('testflight-queue.py'))
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


class QueueTests(unittest.TestCase):
    def test_seed_is_an_exclusive_lower_bound_and_history_becomes_oldest_first(self):
        self.assertEqual(queue.commits_after_seed(['c', 'b', 'seed', 'old'], 'seed'), ['b', 'c'])
        with self.assertRaises(RuntimeError):
            queue.commits_after_seed(['c'], 'missing')

    def test_oldest_unpublished_commit_wins_even_when_wakeup_is_for_newest(self):
        self.assertEqual(queue.next_commit(['a', 'b', 'c'], {'a'}), 'b')

    def test_coalesced_wakeup_still_drains_all_commits(self):
        done = set()
        commits = ['a', 'b', 'c']
        visited = []
        while (sha := queue.next_commit(commits, done)):
            visited.append(sha)
            done.add(sha)
        self.assertEqual(visited, commits)

    def test_cancelled_oldest_commit_is_superseded_by_newer_successful_ci(self):
        self.assertEqual(
            queue.next_ci_eligible_commit(
                ['old', 'new'], set(), {'old': 'terminal', 'new': 'success'}
            ),
            'new',
        )

    def test_pending_oldest_commit_still_preserves_fifo_order(self):
        self.assertIsNone(
            queue.next_ci_eligible_commit(
                ['old', 'new'], set(), {'old': 'pending', 'new': 'success'}
            )
        )

    def test_successful_newer_upload_covers_its_first_parent_ancestors(self):
        self.assertEqual(
            queue.completed_through(['old', 'middle', 'new'], {'new'}),
            {'old', 'middle', 'new'},
        )

    def test_completed_commit_is_not_reuploaded(self):
        self.assertIsNone(queue.next_commit(['a'], {'a'}))

    def test_failed_or_interrupted_attempt_consumes_its_build_number(self):
        self.assertEqual(queue.next_build([{'payload': {'build': 101}}, {'payload': {'build': 102}}]), 103)

    def test_initial_build_and_component_limit(self):
        self.assertEqual(queue.next_build([]), 101)
        with self.assertRaises(RuntimeError):
            queue.next_build([{'payload': {'build': 9999}}])
