using System.Collections.Generic;
using UnityEngine;

namespace _PseudoParadox.Scripts.Core
{
    public class VariantMovement : MonoBehaviour
    {
        public CharacterController controller;
        public Animator animator;
        public float speed = 6f;
        public Clock clock;
        public PlayerPositionManager playerPositionManager;
        public int instanceNumber;
        public GameObject targetPrefab;

        private Dictionary<string, Vector3> previousTimeToPositionDict;

        private Transform target;
        
        private readonly int Forward = Animator.StringToHash("Forward");

        private void Start()
        {
            previousTimeToPositionDict = playerPositionManager.timeMachine[instanceNumber - 1];
            transform.position = GetNewPosition();
            CreateAndPositionTargetToFollow();
        }

        private void Update()
        {
            // ToDo: Animate and have the variant look in the direction they are walking
            StepTowardsNewPosition();
            RotateTowardsNewPosition();
        }

        private void CreateAndPositionTargetToFollow()
        {
            target = Instantiate(targetPrefab).transform;
            var targetTransform = target.transform;
            targetTransform.localScale = new Vector3(0.15f, 1.0f, 0.15f);
            targetTransform.position = targetTransform.position;
        }

        private Vector3 GetNewPosition()
        {
            var key = clock.clockText.text;
            if (previousTimeToPositionDict.ContainsKey(key))
            {
                return previousTimeToPositionDict[key];
            }

            DestroyImmediate(target.gameObject);
            DestroyPlayerClones();

            return new Vector3(0, 0, 0);
        }

        private void StepTowardsNewPosition()
        {
            var newPosition = GetNewPosition();

            if (target == null) return;
            target.position = newPosition;
            var step = speed * Time.deltaTime;
            transform.position = Vector3.MoveTowards(transform.position, target.position, step);
        }

        private void RotateTowardsNewPosition()
        {
            var direction = target.position - transform.position;
            transform.rotation = Quaternion.LookRotation(direction);
            animator.SetFloat(Forward, (direction.magnitude));
        }


        private static void DestroyPlayerClones()
        {
            var playerClones = GameObject.FindGameObjectsWithTag("PlayerClone");
            foreach (var playerClone in playerClones) Destroy(playerClone.gameObject);
        }
    }
}